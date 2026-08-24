import { NextRequest, NextResponse } from 'next/server';
import { getTmsViewer, isBomFinanceApprover } from '@/lib/tmsAccess';
import { tmsBomRequestStore } from '@/lib/tmsBomRequestStore';
import { apiErrorResponse } from '@/lib/apiError';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { notifyUsers } from '@/lib/notificationStore';
import { sendProcurementLifecycleEmail } from '@/lib/email/notifications';
import { findUserByUsername } from '@/lib/userStore';

// admin_approved -> rejected. Gated to the configured Finance Approver, same
// as finance-approve.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getTmsViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await isBomFinanceApprover(viewer))) {
    return NextResponse.json({ error: 'Forbidden — only the configured Finance Approver can decline this request' }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (!reason) return NextResponse.json({ error: 'A reason is required to decline a request' }, { status: 400 });

  try {
    const existing = await tmsBomRequestStore.findById(id);
    if (!existing) return NextResponse.json({ error: 'BOM request not found' }, { status: 404 });
    if (existing.status !== 'admin_approved') {
      return NextResponse.json({ error: 'This request is not awaiting Finance approval' }, { status: 400 });
    }

    const updated = await tmsBomRequestStore.financeDecide(id, 'rejected', viewer.username, reason);

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'tms_bom_request',
      entityId: id,
      action: 'BOM request declined by Finance',
      previousStatus: 'admin_approved',
      newStatus: 'rejected',
      remarks: reason,
      ip: getClientIp(request)
    });

    if (existing.created_by && existing.created_by !== viewer.username) {
      await notifyUsers([existing.created_by], {
        title: 'BOM request declined by Finance',
        body: `"${existing.item_name}" for ${existing.project_name} was declined: ${reason}`,
        type: 'tms_bom_request_finance_rejected',
        entityType: 'tms_bom_request',
        entityId: id
      });
      const requester = await findUserByUsername(existing.created_by);
      if (requester?.email) {
        void sendProcurementLifecycleEmail({
          name: requester.name,
          email: requester.email,
          urlPath: `/tms/bom-requests/${id}`,
          event: 'bom_finance_rejected',
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
