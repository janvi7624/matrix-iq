import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { apiErrorResponse } from '@/lib/apiError';
import { isUuid } from '@/lib/db';
import { canApproveCampaigns, sendCampaignToNewRecipients, resendCampaignToEveryone } from '@/lib/festivalCampaignStore';

// For a campaign that has ALREADY been sent: mails the same email to every
// address not yet mailed — i.e. internal employees. Clients already mailed
// are skipped by the per-recipient unique index.
export const maxDuration = 900;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canApproveCampaigns(viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });

  try {
    const body = await request.json().catch(() => ({}));
    const everyone = Boolean(body && (body as { everyone?: unknown }).everyone === true);
    const summary = everyone ? await resendCampaignToEveryone(id) : await sendCampaignToNewRecipients(id);
    if (!summary) return NextResponse.json({ error: 'Only a campaign that has already been sent can be shared with employees' }, { status: 409 });
    return NextResponse.json({ ok: true, ...summary, to: String(summary.sent) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
