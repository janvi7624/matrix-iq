import { NextRequest, NextResponse } from 'next/server';
import { getPartnerViewer } from '@/lib/partnerContext';
import { listPartnerQuotations } from '@/lib/partnerQuotationStore';
import { apiErrorResponse } from '@/lib/apiError';

// Read-only by construction: this file defines no POST, PATCH or DELETE, so
// there is no code path through which a partner can create, edit, price,
// approve or delete a quotation. That is the requirement, expressed as the
// absence of handlers rather than as a permission check that could be
// mis-specified.
export async function GET(request: NextRequest) {
  const viewer = await getPartnerViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    return NextResponse.json(await listPartnerQuotations(viewer.partnerId));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
