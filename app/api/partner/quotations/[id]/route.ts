import { NextRequest, NextResponse } from 'next/server';
import { getPartnerViewer } from '@/lib/partnerContext';
import { findPartnerQuotation } from '@/lib/partnerQuotationStore';
import { apiErrorResponse } from '@/lib/apiError';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getPartnerViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id } = await params;
    // Resolved through the share table with partner_id in the WHERE, so an
    // unshared or another partner's quotation is indistinguishable from one
    // that does not exist.
    const quotation = await findPartnerQuotation(viewer.partnerId, id);
    if (!quotation) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(quotation);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
