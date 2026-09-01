import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { appendProjectTimeline, findProjectById, projectStore } from '@/lib/projectStore';
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
import { ProjectNote, ProjectPriority, ProjectRecord, ProjectStage, ProjectStatus, PROJECT_STAGES, UserRecord } from '@/lib/types';
import { findUserById } from '@/lib/userStore';
import { notifyUsers } from '@/lib/notificationStore';
import { sendProjectLifecycleEmail } from '@/lib/email/notifications';
import { projectHandoverStore } from '@/lib/projectHandoverStore';
import { resolveVisibilityScope } from '@/lib/departmentScope';
import { db } from '@/lib/db';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { syncTmsProjectForAssignment } from '@/lib/tmsHandoff';

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

const VALID_PRIORITY: ProjectPriority[] = ['low', 'medium', 'high'];
const VALID_STATUS: ProjectStatus[] = ['active', 'on_hold', 'won', 'lost'];

// Single-project access — mirrors projectStore's own list-visibility rule
// (created it, assigned to it, or it belongs to a department this viewer
// manages) rather than the old creator-or-privileged-only check, so a
// department manager can open a team member's project directly by id, but
// nobody can reach another department's project just by knowing its id.
async function canAccessProject(viewerUsername: string, project: { created_by: string; assigned_technical_person_id: string }): Promise<boolean> {
  const scope = await resolveVisibilityScope(viewerUsername);
  if (scope.seesOrgWide) return true;
  const ids = scope.scopedUserIds ?? [];
  if (project.assigned_technical_person_id && ids.includes(project.assigned_technical_person_id)) return true;
  if (!project.created_by) return false;
  const creator = await db.User.findOne({ where: { username: project.created_by } as never, attributes: ['id'] });
  return creator ? ids.includes(creator.get('id') as string) : false;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    const project = await findProjectById(id);
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    if (!(await canAccessProject(viewer.username, project))) {
      // Allow access if user has a pending handover request for this project
      const pendingHandover = await projectHandoverStore.findPendingForProject(id);
      if (!pendingHandover || pendingHandover.to_user_id !== viewer.userId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    const [siteVisits, demos, responses, negotiations, purchaseOrders, installations, deliveryChallans, quotations, marketingRequests] = await Promise.all([
      siteVisitStore.list(viewer.username, true),
      demoScheduleStore.list(viewer.username, true),
      customerResponseStore.list(viewer.username, true),
      negotiationStore.list(viewer.username, true),
      poStore.list(viewer.username, true),
      installationStore.list(viewer.username, true),
      deliveryChallanStore.list(viewer.username, true),
      searchQuotations(),
      marketingRequestStore.list(viewer.username, true)
    ]);

    return NextResponse.json({
      project,
      siteVisits: siteVisits.filter((r) => r.project_id === id),
      demos: demos.filter((r) => r.project_id === id),
      responses: responses.filter((r) => r.project_id === id),
      negotiations: negotiations.filter((r) => r.project_id === id),
      purchaseOrders: purchaseOrders.filter((r) => r.project_id === id),
      installations: installations.filter((r) => r.project_id === id),
      deliveryChallans: deliveryChallans.filter((r) => r.project_id === id),
      quotations: quotations.filter((r) => r.project_id === id),
      marketingRequests: marketingRequests.filter((r) => r.project_id === id)
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
    if (typeof body.source === 'string') patch.source = body.source.trim();
    // Resolved from an actual user id (the UI offers a picker, not free
    // text) so a typo/case mismatch can never silently mislabel this field
    // — see the salesPersonId handling in POST above for the fuller story.
    if (typeof body.salesPersonId === 'string' && body.salesPersonId.trim()) {
      const salesPersonUser = await findUserById(body.salesPersonId.trim());
      if (salesPersonUser) patch.sales_person = salesPersonUser.name || salesPersonUser.username;
    } else if (typeof body.salesPerson === 'string' && body.salesPerson.trim()) {
      patch.sales_person = body.salesPerson.trim();
    }
    if (VALID_PRIORITY.includes(body.priority)) patch.priority = body.priority;
    if (VALID_STATUS.includes(body.status)) patch.status = body.status;
    if (typeof body.expectedClosingDate === 'string') patch.expected_closing_date = body.expectedClosingDate;
    if (typeof body.nextFollowUpDate === 'string') patch.next_follow_up_date = body.nextFollowUpDate;
    if (body.coldCallResponded === 'yes' || body.coldCallResponded === 'no' || body.coldCallResponded === '') patch.cold_call_responded = body.coldCallResponded;
    if (typeof body.remarks === 'string') patch.remarks = body.remarks.trim();

    let newlyAssignedPerson: UserRecord | undefined;
    if (typeof body.assignedTechnicalPersonId === 'string') {
      const nextId = body.assignedTechnicalPersonId.trim();
      if (nextId !== existing.assigned_technical_person_id) {
        patch.assigned_technical_person_id = nextId;
        if (nextId) newlyAssignedPerson = await findUserById(nextId);
      }
    }

    let updated;
    const stage: ProjectStage | undefined = PROJECT_STAGES.includes(body.stage) ? body.stage : undefined;
    if (stage && stage !== existing.stage) {
      updated = await appendProjectTimeline(id, { by: viewer.username, stage, label: `Stage moved to ${stage.replace(/_/g, ' ')}` }, stage);
      if (Object.keys(patch).length > 1) updated = await projectStore.update(id, patch);
    } else if (Object.keys(patch).length > 1) {
      updated = await projectStore.update(id, patch);
    } else {
      updated = existing;
    }

    if (newlyAssignedPerson) {
      const previousName = existing.assigned_technical_person_name || 'Unassigned';
      const label = `Assigned technical person: ${previousName} → ${newlyAssignedPerson.name}`;
      await appendProjectTimeline(id, { by: viewer.username, stage: existing.stage, label });
      await logAudit({
        by: viewer.username,
        role: viewer.role,
        entityType: 'project',
        entityId: id,
        action: 'Project reassigned',
        previousStatus: previousName,
        newStatus: newlyAssignedPerson.name,
        remarks: existing.client_name || existing.company || '',
        ip: getClientIp(request)
      });
      await notifyUsers([newlyAssignedPerson.username], {
        title: 'A project was assigned to you',
        body: `${existing.client_name || existing.company || 'Project'} — assigned as the technical lead`,
        type: 'project_assigned',
        entityType: 'project',
        entityId: id
      });
      void sendProjectLifecycleEmail({
        name: newlyAssignedPerson.name,
        email: newlyAssignedPerson.email,
        projectId: id,
        projectKind: 'sales',
        event: 'assigned',
        projectLabel: existing.client_name || existing.company || 'Project'
      });
      try {
        await syncTmsProjectForAssignment(updated ?? existing, newlyAssignedPerson, viewer.username);
      } catch {
        // Best-effort — the Sales assignment above already succeeded either way.
      }
    }

    // Notify whoever is currently the technical lead when the sales outcome
    // changes — not the actor themselves, who already knows since they just
    // made the change. Uses the POST-patch assignee: if this same request
    // also reassigned the lead (patch.assigned_technical_person_id above),
    // that new person is who should hear about the status, not the one just
    // replaced — reuse newlyAssignedPerson when it's the same id instead of
    // re-fetching.
    const currentTechnicalPersonId = patch.assigned_technical_person_id !== undefined ? patch.assigned_technical_person_id : existing.assigned_technical_person_id;
    if (patch.status && patch.status !== existing.status && currentTechnicalPersonId) {
      const technicalLead =
        newlyAssignedPerson && newlyAssignedPerson.id === currentTechnicalPersonId ? newlyAssignedPerson : await findUserById(currentTechnicalPersonId);
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
