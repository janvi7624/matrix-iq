import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { demoScheduleStore } from '@/lib/demoScheduleStore';
import { appendProjectTimeline } from '@/lib/projectStore';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { DemoScheduleRecord, DemoTechnicalApproval } from '@/lib/types';
import { findUserById, findUsersByIds } from '@/lib/userStore';
import { listDepartmentManagers } from '@/lib/departmentStore';
import { notifyUsers } from '@/lib/notificationStore';
import { sendDemoLifecycleEmail } from '@/lib/email/notifications';

// Strict routing (confirmed decision, tightened further on request): once a
// real person is selected as assigned_technical_person_id, only THAT
// account can respond to this step — admin/superadmin keep a full override,
// nobody else does (not Manager, not "any technical-role account"). A demo
// with no resolvable assignee (legacy record, or one nobody's assigned yet)
// requires an admin/superadmin override too, rather than falling back to a
// broad "any technical/privileged account" rule — an unassigned demo simply
// can't be accepted by anyone else until it's assigned or an admin steps in.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || (body.decision !== 'approved' && body.decision !== 'rejected' && body.decision !== 'reschedule')) {
    return NextResponse.json({ error: 'A valid decision is required' }, { status: 400 });
  }

  try {
    const records = await demoScheduleStore.list(viewer.username, true);
    const existing = records.find((r) => r.id === id);
    if (!existing) return NextResponse.json({ error: 'Demo not found' }, { status: 404 });
    if (existing.status !== 'pending_technical') {
      return NextResponse.json({ error: 'This request is not awaiting technical approval' }, { status: 400 });
    }

    const isOverride = viewer.role === 'admin' || viewer.role === 'superadmin';
    const assignedPerson = existing.assigned_technical_person_id ? await findUserById(existing.assigned_technical_person_id) : undefined;
    if (assignedPerson) {
      if (assignedPerson.username !== viewer.username && !isOverride) {
        return NextResponse.json({ error: `Forbidden — only ${assignedPerson.name} can respond to this request` }, { status: 403 });
      }
    } else if (!isOverride) {
      return NextResponse.json({ error: 'Forbidden — this request has no assigned technical person yet; ask an admin to assign one' }, { status: 403 });
    }

    const technicalApproval: DemoTechnicalApproval = {
      decision: body.decision,
      availability: body.availability === 'available' || body.availability === 'not_available' ? body.availability : '',
      remarks: typeof body.remarks === 'string' ? body.remarks.trim() : '',
      expected_arrival_time: typeof body.expectedArrivalTime === 'string' ? body.expectedArrivalTime : '',
      decided_by: viewer.username,
      decided_at: new Date().toISOString()
    };

    const patch: Partial<DemoScheduleRecord> = { technical_approval: technicalApproval };
    if (body.decision === 'approved') patch.status = 'pending_manager';
    else if (body.decision === 'rejected') patch.status = 'cancelled';
    else if (body.decision === 'reschedule' && typeof body.newScheduledAt === 'string' && body.newScheduledAt) {
      patch.scheduled_at = body.newScheduledAt;
    }

    const updated = await demoScheduleStore.update(id, patch);

    if (body.decision === 'approved' && assignedPerson) {
      if (assignedPerson.department) {
        const managersByDepartment = await listDepartmentManagers();
        const managers = managersByDepartment[assignedPerson.department] || [];
        if (managers.length) {
          await notifyUsers(managers.map((m) => m.username), {
            title: 'Demo request needs your approval',
            body: `${existing.client_name}${existing.company ? ` (${existing.company})` : ''} — confirmed by ${assignedPerson.name}`,
            type: 'demo_manager_approval',
            entityType: 'demo',
            entityId: id
          });
          const managerUsers = await findUsersByIds(managers.map((m) => m.id));
          managerUsers.forEach((managerUser) => {
            if (managerUser.email) {
              void sendDemoLifecycleEmail({
                name: managerUser.name,
                email: managerUser.email,
                event: 'manager_approval',
                clientName: existing.client_name,
                company: existing.company,
                scheduledAt: existing.scheduled_at,
                detail: `Confirmed by ${assignedPerson.name}`
              });
            }
          });
        }
      }
    }

    if (existing.project_id) {
      await appendProjectTimeline(existing.project_id, {
        by: viewer.username,
        stage: 'demo',
        label: `Technical availability: ${body.decision}`,
        remarks: technicalApproval.remarks
      });
    }
    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'demo',
      entityId: id,
      action: `Technical approval: ${body.decision}`,
      previousStatus: 'pending_technical',
      newStatus: patch.status || 'pending_technical',
      remarks: technicalApproval.remarks,
      ip: getClientIp(request)
    });

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
