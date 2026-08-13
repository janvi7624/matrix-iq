import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { listOverrides } from '@/lib/productOverrideStore';
import { apiErrorResponse } from '@/lib/apiError';

// Any authenticated user — quotation estimators need the full override list
// to merge onto their hardcoded catalogs, same as the admin editor.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const catalog = request.nextUrl.searchParams.get('catalog') || undefined;
    return NextResponse.json(await listOverrides(catalog));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
