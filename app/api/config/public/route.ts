import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { getPublicAppConfig } from '@/lib/appConfigStore';
import { apiErrorResponse } from '@/lib/apiError';

// Any authenticated user (not just admin) — the quotation calculator reads
// this to put current company info / T&Cs on the PDF it generates.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const config = await getPublicAppConfig();
    return NextResponse.json(config);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
