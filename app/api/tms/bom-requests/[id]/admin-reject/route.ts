import { NextRequest, NextResponse } from 'next/server';
import { getTmsViewer, isAdministrationManager } from '@/lib/tmsAccess';
import { tmsBomRequestStore } from '@/lib/tmsBomRequestStore';
import { apiErrorResponse } from '@/lib/apiError';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { notifyUsers } from '@/lib/notificationStore';
import { sendProcurementLifecycleEmail } from '@/lib/email/notifications';
import { findUserByUsername } from '@/lib/userStore';

// approved -> rejected. Gated to whoever manages the "Administration"
// department, same as admin-approve.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getTmsViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await isAdministrationManager(viewer))) {
    return NextResponse.json({ error: 'Forbidden — only Administration can decline this request' }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (!reason) return NextResponse.json({ error: 'A reason is required to decline a request' }, { status: 400 });

  try {
    const existing = await tmsBomRequestStore.findById(id);
    if (!existing) return NextResponse.json({ error: 'BOM request not found' }, { status: 404 });
    if (existing.status !== 'approved') {
      return NextResponse.json({ error: 'This request is not awaiting Administration approval' }, { status: 400 });
    }

    const updated = await tmsBomRequestStore.adminDecide(id, 'rejected', viewer.username, reason);

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'tms_bom_request',
      entityId: id,
      action: 'BOM request declined by Administration',
      previousStatus: 'approved',
      newStatus: 'rejected',
      remarks: reason,
      ip: getClientIp(request)
    });

    if (existing.created_by && existing.created_by !== viewer.username) {
      await notifyUsers([existing.created_by], {
        title: 'BOM request declined by Administration',
        body: `"${existing.item_name}" for ${existing.project_name} was declined: ${reason}`,
        type: 'tms_bom_request_admin_rejected',
        entityType: 'tms_bom_request',
        entityId: id
      });
      const requester = await findUserByUsername(existing.created_by);
      if (requester?.email) {
        void sendProcurementLifecycleEmail({
          name: requester.name,
          email: requester.email,
          urlPath: `/tms/bom-requests/${id}`,
          event: 'bom_admin_rejected',
          itemLabel: existing.item_name,
          projectName: existing.project_name,
          detail: `Reason: ${reason}`
        });
      }
    }

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
