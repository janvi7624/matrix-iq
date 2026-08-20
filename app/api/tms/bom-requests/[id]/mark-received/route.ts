import { NextRequest, NextResponse } from 'next/server';
import { getTmsViewer } from '@/lib/tmsAccess';
import { tmsBomRequestStore } from '@/lib/tmsBomRequestStore';
import { apiErrorResponse } from '@/lib/apiError';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';

// payment_done -> received. Only the original requester can confirm they
// have the material in hand (or a privileged override) — not the Finance
// Approver, not Accounts, not any Technical Manager.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getTmsViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    const existing = await tmsBomRequestStore.findById(id);
    if (!existing) return NextResponse.json({ error: 'BOM request not found' }, { status: 404 });

    const isRequester = !!viewer.userId && viewer.userId === existing.requested_by_id;
    if (!isRequester && !viewer.isPrivileged) {
      return NextResponse.json({ error: 'Forbidden — only the requester can confirm material received' }, { status: 403 });
    }
    if (existing.status !== 'payment_done') {
      return NextResponse.json({ error: 'This request is not awaiting material receipt' }, { status: 400 });
    }

    const updated = await tmsBomRequestStore.markReceived(id, viewer.username);

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'tms_bom_request',
      entityId: id,
      action: 'BOM request material received',
      previousStatus: 'payment_done',
      newStatus: 'received',
      remarks: existing.item_name,
      ip: getClientIp(request)
    });

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
