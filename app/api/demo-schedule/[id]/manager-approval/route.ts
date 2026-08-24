import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { demoScheduleStore } from '@/lib/demoScheduleStore';
import { appendProjectTimeline } from '@/lib/projectStore';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { DemoManagerApproval, DemoScheduleRecord } from '@/lib/types';
import { findUserById, listUsers } from '@/lib/userStore';
import { listDepartmentManagers } from '@/lib/departmentStore';
import { notifyUsers } from '@/lib/notificationStore';
import { sendDemoLifecycleEmail } from '@/lib/email/notifications';

// Strict routing (confirmed decision): only the domain manager(s) of the
// assigned technical person's department (Department.managerIds) can
// approve this step — admin/superadmin keep a full override. A demo whose
// assignee has no department, or whose department has no manager set,
// falls back to the old broad "any privileged account" rule so nothing
// gets stuck on an unmapped/legacy record.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || (body.decision !== 'approved' && body.decision !== 'rejected' && body.decision !== 'modified')) {
    return NextResponse.json({ error: 'A valid decision is required' }, { status: 400 });
  }

  try {
    const records = await demoScheduleStore.list(viewer.username, true);
    const existing = records.find((r) => r.id === id);
    if (!existing) return NextResponse.json({ error: 'Demo not found' }, { status: 404 });
    if (existing.status !== 'pending_manager') {
      return NextResponse.json({ error: 'This request is not awaiting manager approval' }, { status: 400 });
    }

    const isOverride = viewer.role === 'admin' || viewer.role === 'superadmin';
    const assignedPerson = existing.assigned_technical_person_id ? await findUserById(existing.assigned_technical_person_id) : undefined;
    const domainManagers = assignedPerson?.department ? (await listDepartmentManagers())[assignedPerson.department] || [] : [];
    if (domainManagers.length) {
      const isDomainManager = domainManagers.some((m) => m.username === viewer.username);
      if (!isDomainManager && !isOverride) {
        return NextResponse.json({ error: `Forbidden — only the ${assignedPerson!.department} manager can approve this request` }, { status: 403 });
      }
    } else if (!viewer.isPrivileged) {
      return NextResponse.json({ error: 'Forbidden — manager only' }, { status: 403 });
    }

    const reassignedEngineerId = typeof body.reassignedEngineerId === 'string' ? body.reassignedEngineerId.trim() : '';
    const reassignedEngineer = reassignedEngineerId ? await findUserById(reassignedEngineerId) : undefined;

    const managerApproval: DemoManagerApproval = {
      decision: body.decision,
      remarks: typeof body.remarks === 'string' ? body.remarks.trim() : '',
      reassigned_engineer: reassignedEngineer ? reassignedEngineer.name : '',
      decided_by: viewer.username,
      decided_at: new Date().toISOString()
    };

    const patch: Partial<DemoScheduleRecord> = { manager_approval: managerApproval };
    if (reassignedEngineer) {
      patch.assigned_technical_person = reassignedEngineer.name;
      patch.assigned_technical_person_id = reassignedEngineer.id;
    }
    if (typeof body.newScheduledAt === 'string' && body.newScheduledAt) patch.scheduled_at = body.newScheduledAt;

    if (body.decision === 'approved') patch.status = 'pending_backoffice';
    else if (body.decision === 'rejected') patch.status = 'cancelled';
    // 'modified' stays at pending_manager — schedule/engineer changes above apply, a follow-up call approves.

    const updated = await demoScheduleStore.update(id, patch);

    if (body.decision === 'approved') {
      const users = await listUsers();
      const backofficeUsers = users.filter((u) => u.status === 'active' && (u.role === 'backoffice' || u.department === 'Back Office'));
      if (backofficeUsers.length) {
        await notifyUsers(
          backofficeUsers.map((u) => u.username),
          {
            title: 'Demo request ready for Back Office',
            body: `${existing.client_name}${existing.company ? ` (${existing.company})` : ''} — approved by ${viewer.username}`,
            type: 'demo_backoffice_ready',
            entityType: 'demo',
            entityId: id
          }
        );
        backofficeUsers.forEach((u) => {
          if (u.email) {
            void sendDemoLifecycleEmail({
              name: u.name,
              email: u.email,
              event: 'backoffice_ready',
              clientName: existing.client_name,
              company: existing.company,
              scheduledAt: existing.scheduled_at,
              detail: `Approved by ${viewer.username}`
            });
          }
        });
      }
    }

    if (existing.project_id) {
      await appendProjectTimeline(existing.project_id, {
        by: viewer.username,
        stage: 'demo',
        label: `Manager review: ${body.decision}`,
        remarks: managerApproval.remarks
      });
    }
    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'demo',
      entityId: id,
      action: `Manager approval: ${body.decision}`,
      previousStatus: 'pending_manager',
      newStatus: patch.status || 'pending_manager',
      remarks: managerApproval.remarks,
      ip: getClientIp(request)
    });

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
