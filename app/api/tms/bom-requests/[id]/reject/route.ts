import { NextRequest, NextResponse } from 'next/server';
import { getTmsViewer, requireTmsAction } from '@/lib/tmsAccess';
import { tmsBomRequestStore } from '@/lib/tmsBomRequestStore';
import { apiErrorResponse } from '@/lib/apiError';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { notifyUsers } from '@/lib/notificationStore';

// submitted/under_review -> rejected. Gated on the 'reject' action — falls
// back to isPrivileged when unconfigured for a role (see
// isModuleActionAllowed), same as every other module's reject route.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getTmsViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const allowed = await requireTmsAction(viewer, 'tms-bom-requests', 'reject');
  if (!allowed) return NextResponse.json({ error: 'Forbidden — only a Technical Manager can decline this request' }, { status: 403 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (!reason) return NextResponse.json({ error: 'A reason is required to decline a request' }, { status: 400 });

  try {
    const existing = await tmsBomRequestStore.findById(id);
    if (!existing) return NextResponse.json({ error: 'BOM request not found' }, { status: 404 });
    if (existing.status !== 'submitted' && existing.status !== 'under_review') {
      return NextResponse.json({ error: 'Only a request awaiting review can be declined' }, { status: 400 });
    }

    const updated = await tmsBomRequestStore.decide(id, 'rejected', viewer.username, reason);

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'tms_bom_request',
      entityId: id,
      action: 'BOM request declined',
      previousStatus: existing.status,
      newStatus: 'rejected',
      remarks: reason,
      ip: getClientIp(request)
    });

    if (existing.created_by && existing.created_by !== viewer.username) {
      await notifyUsers([existing.created_by], {
        title: 'BOM request declined',
        body: `"${existing.item_name}" for ${existing.project_name} was declined: ${reason}`,
        type: 'tms_bom_request_rejected',
        entityType: 'tms_bom_request',
        entityId: id
      });
    }

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
