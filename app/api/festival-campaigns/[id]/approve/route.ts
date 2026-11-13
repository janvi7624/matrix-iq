import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { apiErrorResponse } from '@/lib/apiError';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { isUuid } from '@/lib/db';
import { approveCampaign, canApproveCampaigns } from '@/lib/festivalCampaignStore';

// HR / Marketing manager / Admin sign-off — without it the festival-day
// sweep skips the campaign and no client is emailed.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canApproveCampaigns(viewer))) {
    return NextResponse.json({ error: 'Forbidden — only HR, the Marketing manager or an Admin can approve festival emails' }, { status: 403 });
  }

  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  const body = await request.json().catch(() => ({}));

  try {
    const result = await approveCampaign(id, viewer, { headline: body?.headline, message: body?.message });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'festival_campaign',
      entityId: id,
      action: `Festival client email approved (${result.campaign.festival_name})`,
      previousStatus: 'pending_approval',
      newStatus: 'approved',
      remarks: '',
      ip: getClientIp(request)
    });
    return NextResponse.json(result.campaign);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
