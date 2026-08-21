import { NextRequest, NextResponse } from 'next/server';
import { getTmsViewer, requireTmsAction } from '@/lib/tmsAccess';
import { tmsBomRequestStore } from '@/lib/tmsBomRequestStore';
import { apiErrorResponse } from '@/lib/apiError';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { notifyUsers } from '@/lib/notificationStore';
import { listDepartmentManagers } from '@/lib/departmentStore';

// submitted/under_review -> approved. Gated on the 'approve' action, which
// only Technical Manager (and privileged roles) carry per the seeded
// permission matrix.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getTmsViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireTmsAction(viewer, 'tms-bom-requests', 'approve'))) {
    return NextResponse.json({ error: 'Forbidden — only a Technical Manager can approve this request' }, { status: 403 });
  }

  const { id } = await params;
  try {
    const existing = await tmsBomRequestStore.findById(id);
    if (!existing) return NextResponse.json({ error: 'BOM request not found' }, { status: 404 });
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
    }

    const adminManagers = (await listDepartmentManagers())['Administration'] || [];
    const notifyTargets = adminManagers.map((m) => m.username).filter((u) => u && u !== viewer.username);
    if (notifyTargets.length) {
      await notifyUsers(notifyTargets, {
        title: 'BOM request awaiting Administration approval',
        body: `"${existing.item_name}" for ${existing.project_name} was approved by Technical Manager ${viewer.username}`,
        type: 'tms_bom_request_pending_admin',
        entityType: 'tms_bom_request',
        entityId: id
      });
    }

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
