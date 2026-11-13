import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { apiErrorResponse } from '@/lib/apiError';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { canApproveCampaigns, isClientMailLive, listCampaignOverview, loadRecipientPlan, raiseCampaignNow } from '@/lib/festivalCampaignStore';

// Review screen data: upcoming festivals + their client campaign, the live
// recipient count, and whether real sending is switched on.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canApproveCampaigns(viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const [rows, plan] = await Promise.all([listCampaignOverview(), loadRecipientPlan()]);
    return NextResponse.json({
      rows,
      recipients: { total: plan.recipients.length, invalid: plan.invalid, duplicates: plan.duplicates, unsubscribed: plan.unsubscribed },
      liveSending: isClientMailLive()
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

// "Raise banner request now" — for a festival outside the automatic window.
export async function POST(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canApproveCampaigns(viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => null);
  const festivalId = typeof body?.festivalId === 'string' ? body.festivalId : '';
  if (!festivalId) return NextResponse.json({ error: 'festivalId is required' }, { status: 400 });

  try {
    const result = await raiseCampaignNow(festivalId, viewer);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'festival_campaign',
      entityId: result.campaign.id,
      action: `Festival banner request raised manually (${result.campaign.festival_name})`,
      previousStatus: '',
      newStatus: 'awaiting_creative',
      remarks: '',
      ip: getClientIp(request)
    });
    return NextResponse.json(result.campaign, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
