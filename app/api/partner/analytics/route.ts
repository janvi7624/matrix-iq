import { NextRequest, NextResponse } from 'next/server';
import { getPartnerViewer } from '@/lib/partnerContext';
import { getPartnerAnalytics } from '@/lib/partnerAnalytics';
import { apiErrorResponse } from '@/lib/apiError';

// A partner's own numbers. Computed from rows scoped by partner_id, never
// from a wider set filtered afterwards — see lib/partnerAnalytics.ts.
export async function GET(request: NextRequest) {
  const viewer = await getPartnerViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    return NextResponse.json(await getPartnerAnalytics(viewer.partnerId));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
