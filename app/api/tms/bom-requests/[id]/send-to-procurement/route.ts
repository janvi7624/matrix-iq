import { NextRequest, NextResponse } from 'next/server';
import { getTmsViewer, requireTmsAction } from '@/lib/tmsAccess';
import { tmsBomRequestStore } from '@/lib/tmsBomRequestStore';
import { apiErrorResponse } from '@/lib/apiError';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';

// approved -> sent_for_procurement, creating a linked TmsProcurement row
// (see tmsBomRequestStore.sendToProcurement) — maintains the
// Project -> BOM Request -> Procurement chain.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getTmsViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const allowed = (await requireTmsAction(viewer, 'tms-bom-requests', 'approve')) || (await requireTmsAction(viewer, 'tms-bom-requests', 'manage'));
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  try {
    const existing = await tmsBomRequestStore.findById(id);
    if (!existing) return NextResponse.json({ error: 'BOM request not found' }, { status: 404 });
    if (existing.status !== 'approved') {
      return NextResponse.json({ error: 'Only an approved request can be sent to procurement' }, { status: 400 });
    }

    const result = await tmsBomRequestStore.sendToProcurement(id, viewer.username);
    if (!result) return NextResponse.json({ error: 'BOM request not found' }, { status: 404 });

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'tms_bom_request',
      entityId: id,
      action: 'BOM request sent to procurement',
      previousStatus: 'approved',
      newStatus: 'sent_for_procurement',
      remarks: existing.item_name,
      ip: getClientIp(request)
    });

    return NextResponse.json(result.bomRequest);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
