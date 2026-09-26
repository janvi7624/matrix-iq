import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { appendProjectTimeline, canAccessProject, findProjectById, projectStore, resolveProjectDeadlineTier } from '@/lib/projectStore';
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
import { findUserById } from '@/lib/userStore';
import { findSalesPersonCandidate, SalesOwnerError } from '@/lib/projectSalesOwner';
import { sendProjectLifecycleEmail } from '@/lib/email/notifications';
import { projectHandoverStore } from '@/lib/projectHandoverStore';
import { getClientIp } from '@/lib/requestIp';
import { canViewForPendingRequest, getTechnicalRequestView, requestTechnicalPerson, TechnicalRequestError } from '@/lib/projectTechnicalRequest';
import { canAssignSalesPerson } from '@/lib/projectSalesOwner';
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

    const [siteVisits, demos, responses, negotiations, purchaseOrders, installations, deliveryChallans, quotations, marketingRequests, deadlineExtensions, deadlineTier, linkedLeadRow, technicalRequest, canAssignSales] = await Promise.all([
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
      getTechnicalRequestView(id, viewer, project.created_by),
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
      technicalRequest,
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
    if (body.coldCallResponded === 'yes' || body.coldCallResponded === 'no' || body.coldCallResponded === '') patch.cold_call_responded = body.coldCallResponded;
    if (typeof body.remarks === 'string') patch.remarks = body.remarks.trim();
    if ('closingProbabilityPercent' in body) {
      const raw = body.closingProbabilityPercent;
      const isBlank = raw === '' || raw === null || raw === undefined;
      const num = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
      if (!isBlank && (!Number.isInteger(num) || num < 0 || num > 100)) {
        return NextResponse.json({ error: 'Closing probability must be a whole number between 0 and 100' }, { status: 400 });
      }
      patch.closing_probability_percent = isBlank ? '' : num;
    }
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

    // Removing the technical person applies directly. Picking one never does
    // here — it goes through the same approval request as the project page's
    // picker (lib/projectTechnicalRequest.ts), after the rest of this patch
    // is saved, so no client can bypass the engineer's / manager's approval.
    let requestedTechnicalPersonId = '';
    if (typeof body.assignedTechnicalPersonId === 'string') {
      const nextId = body.assignedTechnicalPersonId.trim();
      if (!nextId && existing.assigned_technical_person_id) patch.assigned_technical_person_id = '';
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
    if (stage && stage !== existing.stage) {
      updated = await appendProjectTimeline(id, { by: viewer.username, stage, label: `Stage moved to ${stage.replace(/_/g, ' ')}` }, stage);
      if (Object.keys(patch).length > 1) updated = await projectStore.update(id, patch);
    } else if (closingAsWon) {
      updated = await appendProjectTimeline(id, { by: viewer.username, stage: existing.stage, label: 'Closed as won' });
      if (Object.keys(patch).length > 1) updated = await projectStore.update(id, patch);
    } else if (Object.keys(patch).length > 1) {
      updated = await projectStore.update(id, patch);
    } else {
      updated = existing;
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
