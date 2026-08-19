import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { marketingRequestStore } from '@/lib/marketingRequestStore';
import { isMarketingManager } from '@/lib/permissions';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { MarketingRequestRecord, MarketingRequestTimeline } from '@/lib/types';

// The one and only place `timeline` is ever written. Once a request already
// has a timeline, this route refuses to touch it — there is deliberately no
// other route, field, or role (including Super Admin) that can revise a
// committed delivery date. That permanence is the entire point of the
// feature: a real commitment, not a moving target. Only reachable once the
// Marketing Manager has already approved the request (see [id]/approve).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const allowed = await isMarketingManager(viewer);
  if (!allowed) return NextResponse.json({ error: 'Forbidden — only the Marketing manager can set a delivery timeline' }, { status: 403 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const expectedDeliveryDate = typeof body?.expectedDeliveryDate === 'string' ? body.expectedDeliveryDate.trim() : '';
  if (!expectedDeliveryDate) {
    return NextResponse.json({ error: 'An expected delivery date is required' }, { status: 400 });
  }

  try {
    const records = await marketingRequestStore.list(viewer.username, true);
    const existing = records.find((r) => r.id === id);
    if (!existing) return NextResponse.json({ error: 'Marketing request not found' }, { status: 404 });
    if (existing.status !== 'approved') {
      return NextResponse.json({ error: 'This request is not awaiting a timeline — it must be approved first' }, { status: 400 });
    }
    if (existing.timeline) {
      return NextResponse.json({ error: 'A delivery timeline has already been committed for this request and cannot be changed' }, { status: 400 });
    }

    const timeline: MarketingRequestTimeline = {
      expectedDeliveryDate,
      setBy: viewer.username,
      setAt: new Date().toISOString(),
      remarks: typeof body?.remarks === 'string' ? body.remarks.trim() : ''
    };
    const patch: Partial<MarketingRequestRecord> = { timeline, status: 'timeline_set', updated_at: new Date().toISOString() };
    const updated = await marketingRequestStore.update(id, patch);

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'marketing_request',
      entityId: id,
      action: `Delivery timeline committed: ${expectedDeliveryDate}`,
      previousStatus: 'approved',
      newStatus: 'timeline_set',
      remarks: timeline.remarks,
      ip: getClientIp(request)
    });

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
