import { NextRequest, NextResponse } from 'next/server';
import { getTmsViewer, requireTmsAction } from '@/lib/tmsAccess';
import { tmsBomRequestStore } from '@/lib/tmsBomRequestStore';
import { apiErrorResponse } from '@/lib/apiError';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { notifyBomStageOne } from '@/lib/tmsBomStageNotify';

// draft -> submitted, and notifies the requester's own department manager.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getTmsViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireTmsAction(viewer, 'tms-bom-requests', 'edit'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  try {
    const existing = await tmsBomRequestStore.findById(id);
    if (!existing) return NextResponse.json({ error: 'BOM request not found' }, { status: 404 });
    if (existing.status !== 'draft') {
      return NextResponse.json({ error: 'Only a draft request can be submitted' }, { status: 400 });
    }

    const updated = await tmsBomRequestStore.submit(id);

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'tms_bom_request',
      entityId: id,
      action: 'BOM request submitted',
      previousStatus: 'draft',
      newStatus: 'submitted',
      remarks: existing.item_name,
      ip: getClientIp(request)
    });

    await notifyBomStageOne({
      requestId: id,
      itemName: existing.item_name,
      projectName: existing.project_name,
      departmentId: existing.department_id,
      actorUsername: viewer.username
    });

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
