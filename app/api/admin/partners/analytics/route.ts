import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { canManagePartners } from '@/lib/partnerAccess';
import { getPartnerComparison } from '@/lib/partnerAnalytics';
import { summariseMaterialAccess } from '@/lib/partnerMaterialStore';
import { apiErrorResponse } from '@/lib/apiError';

// The internal consolidated view — every partner side by side, plus which
// published collateral is actually being opened.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canManagePartners(viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const [partners, materials] = await Promise.all([getPartnerComparison(), summariseMaterialAccess()]);
    return NextResponse.json({ partners, materials });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
