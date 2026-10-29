import { NextRequest, NextResponse } from 'next/server';
import { parseDepartmentAmounts, parseProjectDepartments } from '@/lib/projectDepartmentOptions';
import { getViewerContext } from '@/lib/viewerContext';
import { appendProjectTimeline, canAccessProject, findProjectById, projectStore, resolveProjectDeadlineTier } from '@/lib/projectStore';
import { cancelTmsProjectForLostDeal } from '@/lib/tmsHandoff';
import { listForProject as listDeadlineExtensions } from '@/lib/projectDeadlineExtensionStore';
import { siteVisitStore } from '@/lib/siteVisitStore';
import { demoScheduleStore } from '@/lib/demoScheduleStore';
import { customerResponseStore } from '@/lib/customerResponseStore';
import { negotiationStore } from '@/lib/negotiationStore';
import { poStore } from '@/lib/poStore';
import { installationStore } from '@/lib/installationStore';
import { deliveryChallanStore } from '@/lib/deliveryChallanStore';
import { searchQuotations } from '@/lib/quotationStore';
import { marketingRequestStore } from '@/lib/marketingRequestStore';
import { apiErrorResponse } from '@/lib/apiError';
import { ProjectNote, ProjectPriority, ProjectRecord, ProjectStage, ProjectStatus } from '@/lib/types';
import { ASSIGNABLE_STAGES, FORWARD_STAGES } from '@/lib/projectStages';
import { LOST_REASONS, LOST_REASON_LABEL, isLostReason, normalizeStage, stageGateFailures, type GateFailure } from '@/lib/salesStageRules';
import {
  evaluateWonGate,
  latestQuotationForProject,
  recordWinningPurchaseOrder,
  type PurchaseOrderInput
} from '@/lib/salesStageGateSources';
import { findUserById } from '@/lib/userStore';
import { findSalesPersonCandidate, SalesOwnerError } from '@/lib/projectSalesOwner';
import { sendProjectLifecycleEmail } from '@/lib/email/notifications';
import { projectHandoverStore } from '@/lib/projectHandoverStore';
import { getClientIp } from '@/lib/requestIp';
import { canViewForPendingRequest, findPendingTechnicalRequests, getTechnicalRequestViews, removeTechnicalPerson, requestTechnicalPerson, TechnicalRequestError } from '@/lib/projectTechnicalRequest';
import { canAssignSalesPerson } from '@/lib/projectSalesOwner';
import { resolveProjectLead } from '@/lib/projectLeadStore';
import { OPPORTUNITY_TYPE_LABEL, parseOpportunityType } from '@/lib/projectLeadOptions';
import { db } from '@/lib/db';

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

const VALID_PRIORITY: ProjectPriority[] = ['low', 'medium', 'high'];
const VALID_STATUS: ProjectStatus[] = ['active', 'on_hold', 'won', 'lost'];


export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    const project = await findProjectById(id);
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    if (!(await canAccessProject(viewer.username, project))) {
      // Allow access if user has a pending handover request for this project,
      // or is being asked to approve a technical person for it — they need
      // to see what they'd be committing to before saying yes.
      const pendingHandover = await projectHandoverStore.findPendingForProject(id);
      const isHandoverRecipient = !!pendingHandover && pendingHandover.to_user_id === viewer.userId;
      if (!isHandoverRecipient && !(await canViewForPendingRequest(id, viewer))) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    const [siteVisits, demos, responses, negotiations, purchaseOrders, installations, deliveryChallans, quotations, marketingRequests, deadlineExtensions, deadlineTier, linkedLeadRow, technicalRequests, canAssignSales] = await Promise.all([
      siteVisitStore.list(viewer.username, true),
      demoScheduleStore.list(viewer.username, true),
      customerResponseStore.list(viewer.username, true),
      negotiationStore.list(viewer.username, true),
      poStore.list(viewer.username, true),
      installationStore.list(viewer.username, true),
      deliveryChallanStore.list(viewer.username, true),
      searchQuotations(),
      marketingRequestStore.list(viewer.username, true),
      listDeadlineExtensions(id),
      resolveProjectDeadlineTier(viewer),
      // "Created From Lead" (Part 13) — the only link is the reverse
      // Lead.project_id FK; a Project has no lead_id column of its own.
      db.Lead.findOne({ where: { project_id: id } as never, attributes: ['id', 'name'] }),
      getTechnicalRequestViews(id, viewer, project.created_by),
      // Drives the project page's "Assign Sales Person" (lib/projectSalesOwner.ts).
      canAssignSalesPerson(viewer, project)
    ]);
    const linkedLead = linkedLeadRow ? (linkedLeadRow.get({ plain: true }) as { id: string; name: string }) : null;

    return NextResponse.json({
      project,
      linkedLead,
      siteVisits: siteVisits.filter((r) => r.project_id === id),
      demos: demos.filter((r) => r.project_id === id),
      responses: responses.filter((r) => r.project_id === id),
      negotiations: negotiations.filter((r) => r.project_id === id),
      purchaseOrders: purchaseOrders.filter((r) => r.project_id === id),
      installations: installations.filter((r) => r.project_id === id),
      deliveryChallans: deliveryChallans.filter((r) => r.project_id === id),
      quotations: quotations.filter((r) => r.project_id === id),
      marketingRequests: marketingRequests.filter((r) => r.project_id === id),
      deadlineExtensions,
      deadlineTier,
      technicalRequests,
      canAssignSalesPerson: canAssignSales
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  try {
    const existing = await findProjectById(id);
    if (!existing) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    if (!(await canAccessProject(viewer.username, existing))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (body.action === 'addRemark') {
      const remarks = typeof body.remarks === 'string' ? body.remarks.trim() : '';
      if (!remarks) return NextResponse.json({ error: 'Remarks are required' }, { status: 400 });
      const updated = await appendProjectTimeline(id, { by: viewer.username, stage: existing.stage, label: 'Remark added', remarks });
      return NextResponse.json(updated);
    }

    if (body.action === 'addNote') {
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (!text) return NextResponse.json({ error: 'Note text is required' }, { status: 400 });
      const note: ProjectNote = { id: `${Date.now()}`, at: new Date().toISOString(), by: viewer.username, text };
      const updated = await projectStore.update(id, { notes: [...existing.notes, note], updated_at: new Date().toISOString() });
      return NextResponse.json(updated);
    }

    if (body.action === 'addAttachment') {
      const urls = toStringArray(body.urls);
      if (!urls.length) return NextResponse.json({ error: 'No attachment URLs provided' }, { status: 400 });
      const updated = await projectStore.update(id, { attachments: [...existing.attachments, ...urls], updated_at: new Date().toISOString() });
      await appendProjectTimeline(id, { by: viewer.username, stage: existing.stage, label: `${urls.length} attachment${urls.length === 1 ? '' : 's'} added` });
      return NextResponse.json(updated);
    }

    const patch: Partial<ProjectRecord> = { updated_at: new Date().toISOString() };
    if (typeof body.clientName === 'string') patch.client_name = body.clientName.trim();
    if (typeof body.company === 'string') patch.company = body.company.trim();
    if (typeof body.contactPerson === 'string') patch.contact_person = body.contactPerson.trim();
    if (typeof body.altContactPhone === 'string') patch.alt_contact_phone = body.altContactPhone.trim();
    if (typeof body.phone === 'string') patch.phone = body.phone.trim();
    if (typeof body.email === 'string') patch.email = body.email.trim();
    if (typeof body.address === 'string') patch.address = body.address.trim();
    if (typeof body.source === 'string') {
      const source = body.source.trim();
      if (!source) return NextResponse.json({ error: 'Source is required' }, { status: 400 });
      patch.source = source;
    }
    // Project Lead / Mentor — can be changed to the other fixed lead but never
    // cleared or set to anyone outside lib/projectLeadOptions.ts.
    let newProjectLeadName = '';
    if ('projectLeadId' in body) {
      const lead = await resolveProjectLead(body.projectLeadId);
      if (!lead) return NextResponse.json({ error: 'Project Lead / Mentor is required — pick one from the list' }, { status: 400 });
      if (lead.id !== existing.project_lead_id) {
        patch.project_lead_id = lead.id;
        newProjectLeadName = lead.name;
      }
    }
    // Opportunity Type — either value, never cleared. Changing it does NOT
    // move the lead (that default only applies while a project is being
    // filled in, on the form); the lead stays whatever it was set to.
    let newOpportunityTypeLabel = '';
    if ('opportunityType' in body) {
      const type = parseOpportunityType(body.opportunityType);
      if (!type) return NextResponse.json({ error: 'Opportunity Type is required — Distribution or Project' }, { status: 400 });
      if (type !== existing.opportunity_type) {
        patch.opportunity_type = type;
        newOpportunityTypeLabel = OPPORTUNITY_TYPE_LABEL[type];
      }
    }
    // Resolved from an actual user id (the UI offers a picker, not free
    // text) so a typo/case mismatch can never silently mislabel this field
    // — see the salesPersonId handling in POST above for the fuller story.
    //
    // Must be an active member of Sales, same rule the create and
    // assign-sales-person routes enforce. This label is what the Projects
    // list, its Sales Person filter and every export read, so letting it
    // name a technical person here just moved the same wrong answer to a
    // different screen. The old free-text `salesPerson` fallback is gone
    // with it: nothing in the app sent it, and it accepted any string at
    // all, which is the same hole without even a user behind it.
    if (typeof body.salesPersonId === 'string' && body.salesPersonId.trim()) {
      try {
        patch.sales_person = (await findSalesPersonCandidate(body.salesPersonId.trim())).username;
      } catch (error) {
        if (error instanceof SalesOwnerError) return NextResponse.json({ error: error.message }, { status: error.status });
        return apiErrorResponse(error);
      }
    }
    if (VALID_PRIORITY.includes(body.priority)) patch.priority = body.priority;
    if (VALID_STATUS.includes(body.status)) patch.status = body.status;
    // expectedClosingDate deliberately NOT accepted here anymore — it's the
    // project's "deadline" now, and every change to it must go through
    // POST /api/projects/[id]/extend-deadline so a reason + mandatory remark
    // is always captured (previously this silently overwrote it with zero
    // history). next_follow_up_date is a plain reminder date, unaffected.
    if (typeof body.nextFollowUpDate === 'string') patch.next_follow_up_date = body.nextFollowUpDate;
    // Intake fields (lib/projectIntake.ts) — accepted individually here,
    // unlike POST's all-at-once parseProjectIntake, since this is a Proposal
    // form filling in ONE missing detail (onFillProject in
    // components/QuotationCalculator.tsx), not resubmitting the whole block.
    // No required-ness enforced on PATCH; that only ever applies at creation.
    if (typeof body.project_name === 'string') patch.project_name = body.project_name.trim();
    if (typeof body.city === 'string') patch.city = body.city.trim();
    if (typeof body.state === 'string') patch.state = body.state.trim();
    if (typeof body.payment_terms === 'string') patch.payment_terms = body.payment_terms.trim().slice(0, 2000);
    if (typeof body.tender_ref_number === 'string') patch.tender_ref_number = body.tender_ref_number.trim().slice(0, 120);
    if (typeof body.tender_deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.tender_deadline)) patch.tender_deadline = body.tender_deadline;
    if (typeof body.tender_pbg === 'string') patch.tender_pbg = body.tender_pbg.trim().slice(0, 255);
    if ('tender_emd' in body) {
      const num = Number(body.tender_emd);
      if (Number.isFinite(num) && num >= 0) patch.tender_emd = num;
    }
    if ('tender_estimated_value' in body) {
      const num = Number(body.tender_estimated_value);
      if (Number.isFinite(num) && num >= 0) patch.tender_estimated_value = num;
    }
    // Stages marked "not required" — e.g. Site Visit on a deal whose demo was
    // given virtually. Only real forward stages can be skipped: the terminal
    // 'closed_lost' is an outcome rather than a step, and the stage a project
    // is currently ON cannot be skipped, which would otherwise leave it parked
    // on a step it claims not to need.
    if (Array.isArray(body.skippedStages)) {
      const requested: ProjectStage[] = (body.skippedStages as unknown[]).filter(
        (value): value is ProjectStage => typeof value === 'string' && FORWARD_STAGES.includes(value as ProjectStage)
      );
      const currentStage = (typeof body.stage === 'string' && ASSIGNABLE_STAGES.includes(body.stage) ? body.stage : existing.stage) as ProjectStage;
      const invalid = requested.filter((value) => value === currentStage);
      if (invalid.length) {
        return NextResponse.json({ error: `The project is on ${invalid[0]} right now, so it can't be marked as not required.` }, { status: 400 });
      }
      patch.skipped_stages = Array.from(new Set(requested));
    }
    // Delivery department — AI, AV or Robotics, exactly one. Only applied
    // when the key is actually present, so every other
    // edit on this page leaves the existing value alone. Clearing back to
    // none is allowed: the field is optional, and a project set by mistake
    // has to be able to go back to blank.
    if ('departments' in body) {
      const nextDepartments = parseProjectDepartments(body.departments);
      patch.departments = nextDepartments;
      // Re-parsed against the NEW department list, so dropping a department
      // drops its share with it rather than leaving an orphaned amount.
      patch.department_amounts =
        nextDepartments.length > 1
          ? parseDepartmentAmounts(
              'departmentAmounts' in body ? body.departmentAmounts : existing.department_amounts,
              nextDepartments
            )
          : {};
    }
    if (body.coldCallResponded === 'yes' || body.coldCallResponded === 'no' || body.coldCallResponded === '') patch.cold_call_responded = body.coldCallResponded;
    if (typeof body.remarks === 'string') patch.remarks = body.remarks.trim();
    // Required before Won (STATUS_GATES), optional otherwise — same rule as
    // project_name/company below in the gate block, not here.
    if (typeof body.projectBrief === 'string') patch.project_brief = body.projectBrief.trim();
    // Why a deal was lost. Required by the Lost gate
    // (lib/salesStageRules.ts STATUS_GATES), and validated against the
    // agreed vocabulary HERE rather than trusted: the gate only checks the
    // value is non-blank and on the list, so free text would clear the
    // blank check and then fail the membership check with a message about a
    // field the person thought they had just filled in.
    if (typeof body.lostReason === 'string' && body.lostReason.trim()) {
      const reason = body.lostReason.trim();
      if (!isLostReason(reason)) {
        return NextResponse.json(
          { error: `Lost Reason must be one of ${LOST_REASONS.map((r) => LOST_REASON_LABEL[r]).join(', ')}.` },
          { status: 400 }
        );
      }
      patch.lost_reason = reason;
    }
    // closingProbabilityPercent is deliberately NOT read from the body any
    // more. Closing % is derived from the stage on every read, and an admin
    // changes it only through POST /api/projects/[id]/closing-percent, which
    // demands a reason and writes an audit row.
    //
    // Anything sent under the old key is ignored rather than rejected, so a
    // client that has not been updated keeps saving successfully instead of
    // failing on a field it is no longer allowed to set. projectStore marks
    // the column readOnly, so even a hand-crafted patch cannot reach it —
    // this route is a convenience, not the control.
    if ('approxPrice' in body) {
      const raw = body.approxPrice;
      const num = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
      // Unlike creation, blank is allowed here — an auto-created-from-lead
      // project legitimately starts with no price (see
      // lib/leadProjectAutomation.ts), and this is the field the assignee
      // fills in while completing it. A NON-blank value must still be a
      // real positive number.
      const isBlank = raw === '' || raw === null || raw === undefined;
      if (!isBlank && (!Number.isFinite(num) || num <= 0)) {
        return NextResponse.json({ error: 'Approx. Project Price must be a positive number' }, { status: 400 });
      }
      patch.approx_price = isBlank ? '' : num;
    }

    // Removing a technical person applies directly — lib/projectTechnicalRequest.ts's
    // removeTechnicalPerson promotes the next remaining assignee to primary
    // (or clears to '' if none are left), rather than this route blanking the
    // column itself, so the project_technical_assignments table never
    // disagrees with it. Picking one never applies directly here — it goes
    // through the same approval request as the project page's picker, after
    // the rest of this patch is saved, so no client can bypass the
    // engineer's / manager's approval.
    let requestedTechnicalPersonId = '';
    let removeTechnicalPersonId = typeof body.removeTechnicalPersonId === 'string' ? body.removeTechnicalPersonId.trim() : '';
    if (typeof body.assignedTechnicalPersonId === 'string') {
      const nextId = body.assignedTechnicalPersonId.trim();
      // Legacy path (the single-person picker's old "Remove technical
      // person" option): blanking it removes whoever is currently primary.
      if (!removeTechnicalPersonId && !nextId && existing.assigned_technical_person_id) removeTechnicalPersonId = existing.assigned_technical_person_id;
      else if (nextId && nextId !== existing.assigned_technical_person_id) requestedTechnicalPersonId = nextId;
    }

    let updated;
    const stage: ProjectStage | undefined = ASSIGNABLE_STAGES.includes(body.stage) ? body.stage : undefined;
    // "Close Project → Won" used to work by setting stage to the now-retired
    // 'completed' value, which is how it got both a timeline entry and (via
    // appendProjectTimeline's side effect) the status flip in one call. Now
    // that path only sets status directly, so this logs the same kind of
    // timeline entry without touching stage.
    const closingAsWon = patch.status === 'won' && existing.status !== 'won';
    // Winning the deal is the handover to the technical team, so a won
    // project must have a technical owner. Without this, a project closes as
    // won with nobody technical on it, and the TMS project created for it
    // carries no manager and no dates — which is how TMS ended up full of
    // ownerless projects dragging the department gauge down.
    //
    // Note "assigned OR requested": picking a technical person never applies
    // directly (see requestedTechnicalPersonId above), it raises an approval
    // request, so requiring an already-assigned person would make it
    // impossible to close a deal on the same day the pick was made. A pick in
    // this same call, or one already awaiting approval, both satisfy it.
    if (closingAsWon && !existing.assigned_technical_person_id && !requestedTechnicalPersonId) {
      const pending = await findPendingTechnicalRequests(id);
      if (!pending.length) {
        return NextResponse.json(
          { error: 'Assign a technical owner before closing this project as won.' },
          { status: 400 }
        );
      }
    }
    // --- stage gates ------------------------------------------------
    // Checked here, which is before BOTH the patch and
    // appendProjectTimeline: a refused transition must not leave a "Stage
    // moved to ..." event behind describing a move that never happened, and
    // must not half-apply the rest of the patch either.
    //
    // Judged against the record AS IT WOULD BE — existing merged with the
    // patch — so a request that supplies the missing field in the same call
    // as the stage change passes. Making someone save twice to advance a
    // deal would be its own kind of broken.
    //
    // Only on a TRANSITION. A project merely sitting in a stage is never
    // re-judged, which is what keeps the 100 active projects with no
    // expected closing date and the 48 with no price editable: a legacy
    // record stays readable and correctable, and only has to satisfy the
    // gate on its way forward.
    const nextStage = (stage ?? existing.stage) as ProjectStage;
    const nextStatus = (patch.status ?? existing.status) as ProjectStatus;
    const stageChanging = Boolean(stage) && stage !== existing.stage;
    const closingOut = (nextStatus === 'won' || nextStatus === 'lost') && nextStatus !== existing.status;

    if (stageChanging || closingOut) {
      const merged: Record<string, unknown> = {
        ...(existing as unknown as Record<string, unknown>),
        ...(patch as Record<string, unknown>)
      };

      // Quotation: fill from the newest linked quotation before judging.
      // The quotation module is authoritative wherever it is actually used,
      // and asking someone to retype a total the app already holds would be
      // absurd. Where no quotation exists — the common case, since the quote
      // often goes out by email — the typed-in fields stand.
      if (normalizeStage(nextStage) === 'quotation') {
        if (!merged.quote_value || !merged.quotation_date) {
          const quote = await latestQuotationForProject(id);
          if (quote) {
            if (!merged.quote_value && quote.total !== null) {
              merged.quote_value = quote.total;
              patch.quote_value = quote.total;
            }
            if (!merged.quotation_date && quote.date) {
              merged.quotation_date = quote.date;
              patch.quotation_date = quote.date;
            }
          }
        }
      }

      // Won's gate (the PO lookup, the blank-field checklist and the
      // quotation-existence check) is NOT inline here any more: it is shared
      // with every other route that can close a deal, in
      // lib/salesStageGateSources.ts evaluateWonGate. Keeping it here is
      // precisely why POST /api/po and PATCH /api/installation/[id] — which
      // flip status to 'won' themselves — closed 14 of 16 won deals with no
      // Project Brief. One definition, three callers.
      let winningPo: PurchaseOrderInput | null = null;
      let failures: GateFailure[];
      if (nextStatus === 'won') {
        const won = await evaluateWonGate(id, nextStage, merged, {
          po_number: typeof body.poNumber === 'string' ? body.poNumber.trim() : '',
          po_value: body.poValue,
          po_date: typeof body.poDate === 'string' ? body.poDate : ''
        });
        failures = won.failures;
        winningPo = won.winningPo;
      } else {
        failures = stageGateFailures(nextStage, nextStatus, merged);
      }
      if (failures.length) {
        return NextResponse.json(
          {
            error: failures.map((f) => f.message).join(' '),
            fields: failures.map((f) => ({ field: f.field, label: f.label, message: f.message }))
          },
          { status: 400 }
        );
      }

      // Past the gate, so the PO is a fact worth recording. Outside the
      // project transaction on purpose: a PO is a separate business record,
      // and failing to write it must not roll back a legitimate win.
      if (winningPo) {
        await recordWinningPurchaseOrder(id, viewer.userId, winningPo);
      }
    }

    if (stage && stage !== existing.stage) {
      updated = await appendProjectTimeline(id, { by: viewer.username, stage, label: `Stage moved to ${stage.replace(/_/g, ' ')}` }, stage);
      if (Object.keys(patch).length > 1) updated = await projectStore.update(id, patch);
      if (stage === 'closed_lost' && existing.tms_project_id) {
        try {
          await cancelTmsProjectForLostDeal(existing.tms_project_id);
        } catch {
          // Best-effort — the Sales side has already closed either way.
        }
      }
    } else if (closingAsWon) {
      updated = await appendProjectTimeline(id, { by: viewer.username, stage: existing.stage, label: 'Closed as won' });
      if (Object.keys(patch).length > 1) updated = await projectStore.update(id, patch);
    } else if (Object.keys(patch).length > 1) {
      updated = await projectStore.update(id, patch);
    } else {
      updated = existing;
    }

    // Recorded after the patch is saved so the project page's Activity Log
    // shows who was made lead and by whom.
    if (newProjectLeadName) {
      updated = await appendProjectTimeline(id, { by: viewer.username, stage: existing.stage, label: `Project lead set to ${newProjectLeadName}` });
    }
    if (newOpportunityTypeLabel) {
      updated = await appendProjectTimeline(id, { by: viewer.username, stage: existing.stage, label: `Opportunity type set to ${newOpportunityTypeLabel}` });
    }

    if (removeTechnicalPersonId) {
      try {
        const afterRemoval = await removeTechnicalPerson(updated ?? existing, removeTechnicalPersonId, viewer, getClientIp(request));
        if (afterRemoval) updated = afterRemoval;
      } catch (error) {
        if (error instanceof TechnicalRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
        throw error;
      }
    }

    if (requestedTechnicalPersonId) {
      try {
        const result = await requestTechnicalPerson(updated ?? existing, requestedTechnicalPersonId, viewer, { note: '', neededBy: '' }, getClientIp(request));
        if (result.mode === 'assigned' && result.project) updated = result.project;
      } catch (error) {
        if (error instanceof TechnicalRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
        throw error;
      }
    }

    // Notify whoever is currently the technical lead when the sales outcome
    // changes — not the actor themselves, who already knows since they just
    // made the change. Uses the POST-patch assignee (a direct assignment in
    // this same request counts; a pending request doesn't).
    const currentTechnicalPersonId = updated?.assigned_technical_person_id ?? existing.assigned_technical_person_id;
    if (patch.status && patch.status !== existing.status && currentTechnicalPersonId) {
      const technicalLead = await findUserById(currentTechnicalPersonId);
      if (technicalLead?.email && technicalLead.username !== viewer.username) {
        void sendProjectLifecycleEmail({
          name: technicalLead.name,
          email: technicalLead.email,
          projectId: id,
          projectKind: 'sales',
          event: 'status_changed',
          projectLabel: existing.client_name || existing.company || 'Project',
          detail: `Status: ${patch.status.replace(/_/g, ' ')}`
        });
      }
    }

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (viewer.role !== 'superadmin') {
    return NextResponse.json({ error: 'Forbidden — superadmin only' }, { status: 403 });
  }

  const { id } = await params;
  try {
    const result = await projectStore.remove(id, viewer.username, true);
    if (!result.ok) {
      const status = result.reason === 'Project not found' ? 404 : 400;
      return NextResponse.json({ error: result.reason }, { status });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
