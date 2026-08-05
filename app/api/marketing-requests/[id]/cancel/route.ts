import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { marketingRequestStore } from '@/lib/marketingRequestStore';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';

// The requester can only withdraw their own ticket before a reviewer has
// committed to it — once a timeline exists, cancelling would undo a real
// commitment someone else already made, so it's blocked past that point.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    const records = await marketingRequestStore.list(viewer.username, true);
    const existing = records.find((r) => r.id === id);
    if (!existing) return NextResponse.json({ error: 'Marketing request not found' }, { status: 404 });
    if (existing.created_by !== viewer.username && !viewer.isPrivileged) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (existing.status !== 'submitted') {
      return NextResponse.json({ error: 'This request already has a committed timeline and can no longer be cancelled' }, { status: 400 });
    }

    const updated = await marketingRequestStore.update(id, { status: 'cancelled', updated_at: new Date().toISOString() });

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'marketing_request',
      entityId: id,
      action: 'Marketing request cancelled',
      previousStatus: 'submitted',
      newStatus: 'cancelled',
      remarks: '',
      ip: getClientIp(request)
    });

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
