import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { apiErrorResponse } from '@/lib/apiError';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { isUuid } from '@/lib/db';
import { canApproveCampaigns, rejectCampaign } from '@/lib/festivalCampaignStore';

// Send the banner back to Marketing with a reason; reopens their request.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canApproveCampaigns(viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  const body = await request.json().catch(() => null);
  const reason = typeof body?.reason === 'string' ? body.reason : '';

  try {
    const result = await rejectCampaign(id, viewer, reason);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'festival_campaign',
      entityId: id,
      action: `Festival banner sent back to Marketing (${result.campaign.festival_name})`,
      previousStatus: 'pending_approval',
      newStatus: 'awaiting_creative',
      remarks: reason.trim(),
      ip: getClientIp(request)
    });
    return NextResponse.json(result.campaign);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
