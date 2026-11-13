import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { apiErrorResponse } from '@/lib/apiError';
import { isUuid } from '@/lib/db';
import { canApproveCampaigns, findCampaign, previewCampaign } from '@/lib/festivalCampaignStore';

// Rendered client email HTML for the review screen's preview frame. Uses the
// authenticated banner URL, so it works before approval.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canApproveCampaigns(viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });

  try {
    const campaign = await findCampaign(id);
    if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    const headline = request.nextUrl.searchParams.get('headline');
    const message = request.nextUrl.searchParams.get('message');
    const { html } = previewCampaign({ ...campaign, headline: headline ?? campaign.headline, message: message ?? campaign.message });
    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        // Rendered inside a sandboxed iframe on the review screen; no scripts.
        'Content-Security-Policy': "default-src 'none'; img-src 'self' https: data:; style-src 'unsafe-inline'"
      }
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
