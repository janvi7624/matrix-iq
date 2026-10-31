import { NextRequest, NextResponse } from 'next/server';
import { canDecideBomStageOne, getTmsViewer } from '@/lib/tmsAccess';
import { tmsBomRequestStore } from '@/lib/tmsBomRequestStore';
import { apiErrorResponse } from '@/lib/apiError';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { notifyUsers } from '@/lib/notificationStore';
import { sendProcurementLifecycleEmail } from '@/lib/email/notifications';
import { findUserByUsername, findUsersByUsernames } from '@/lib/userStore';
import { listDepartmentManagers } from '@/lib/departmentStore';

// submitted/under_review -> approved. Gated on the 'approve' action AND on
// managing the request's own department: the permission matrix grants the
// action to every Technical Manager org-wide, which on its own let the AI or
// AV manager approve a Robotics request they were never meant to see. See
// canDecideBomStageOne.
//
// The request is loaded BEFORE the gate, because the gate now depends on
// which department it belongs to.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getTmsViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    const existing = await tmsBomRequestStore.findById(id);
    if (!existing) return NextResponse.json({ error: 'BOM request not found' }, { status: 404 });
    if (!(await canDecideBomStageOne(viewer, existing.department_id, 'approve'))) {
      return NextResponse.json(
        { error: `Forbidden — only the ${existing.department_name || 'requesting'} department's manager can approve this request` },
        { status: 403 }
      );
    }
    if (existing.status !== 'submitted' && existing.status !== 'under_review') {
      return NextResponse.json({ error: 'Only a request awaiting review can be approved' }, { status: 400 });
    }

    const updated = await tmsBomRequestStore.decide(id, 'approved', viewer.username);

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'tms_bom_request',
      entityId: id,
      action: 'BOM request approved',
      previousStatus: existing.status,
      newStatus: 'approved',
      remarks: existing.item_name,
      ip: getClientIp(request)
    });

    if (existing.requested_by_name && existing.created_by !== viewer.username) {
      await notifyUsers([existing.created_by], {
        title: 'BOM request approved',
        body: `"${existing.item_name}" for ${existing.project_name} was approved by ${viewer.username}`,
        type: 'tms_bom_request_approved',
        entityType: 'tms_bom_request',
        entityId: id
      });
      const requester = await findUserByUsername(existing.created_by);
      if (requester?.email) {
        void sendProcurementLifecycleEmail({
          name: requester.name,
          email: requester.email,
          urlPath: `/tms/bom-requests/${id}`,
          event: 'bom_approved',
          itemLabel: existing.item_name,
          projectName: existing.project_name,
          detail: `Approved by ${viewer.username}`
        });
      }
    }

    const adminManagers = (await listDepartmentManagers())['Administration'] || [];
    const notifyTargets = adminManagers.filter((m) => m.username && m.username !== viewer.username);
    if (notifyTargets.length) {
      await notifyUsers(notifyTargets.map((m) => m.username), {
        title: 'BOM request awaiting Management approval',
        body: `"${existing.item_name}" for ${existing.project_name} was approved by ${existing.department_name || 'the department'} manager ${viewer.username}`,
        type: 'tms_bom_request_pending_admin',
        entityType: 'tms_bom_request',
        entityId: id
      });
      const managerUsers = await findUsersByUsernames(notifyTargets.map((m) => m.username));
      managerUsers.forEach((managerUser) => {
        if (managerUser.email) {
          void sendProcurementLifecycleEmail({
            name: managerUser.name,
            email: managerUser.email,
            urlPath: `/tms/bom-requests/${id}`,
            event: 'bom_pending_admin',
            itemLabel: existing.item_name,
            projectName: existing.project_name,
            detail: `Approved by ${existing.department_name || 'the department'} manager ${viewer.username}`
          });
        }
      });
    }

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
