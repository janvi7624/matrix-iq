import { NextRequest, NextResponse } from 'next/server';
import { getPartnerViewer } from '@/lib/partnerContext';
import { marketingRequestStore } from '@/lib/marketingRequestStore';
import { toPartnerVisibleMarketingRequest } from '@/lib/partnerMarketingVisibility';
import { apiErrorResponse } from '@/lib/apiError';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getPartnerViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    // findForPartner scopes on partner_id in the WHERE — a request belonging
    // to another partner is "not found", not "forbidden", so the endpoint
    // cannot be used to probe which ids exist.
    const record = await marketingRequestStore.findForPartner(id, viewer.partnerId);
    if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(toPartnerVisibleMarketingRequest(record));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
