import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { getPublicAppConfig } from '@/lib/appConfigStore';
import { apiErrorResponse } from '@/lib/apiError';

// Any authenticated user (not just admin) — the quotation calculator reads
// this to put current company info / T&Cs on the PDF it generates.
//
// Partners too: the portal builds the same customer-facing PDF for a shared
// quotation, and without the company header it would come out branded as
// nothing. This is public-facing company information — the legal name and
// address printed on every quotation we issue — not internal configuration.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request, { allowPartner: true });
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const config = await getPublicAppConfig();
    return NextResponse.json(config);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
