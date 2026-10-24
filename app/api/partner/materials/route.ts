import { NextRequest, NextResponse } from 'next/server';
import { getPartnerViewer } from '@/lib/partnerContext';
import { listPartnerMaterials } from '@/lib/partnerMaterialStore';
import { apiErrorResponse } from '@/lib/apiError';

// Published collateral only. GET-only by construction: a partner has no way
// to add, edit or remove anything in the library.
export async function GET(request: NextRequest) {
  const viewer = await getPartnerViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    return NextResponse.json(await listPartnerMaterials(viewer.partnerId));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
