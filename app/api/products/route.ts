import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { listActiveProducts } from '@/lib/productStore';
import { apiErrorResponse } from '@/lib/apiError';

// Any authenticated user — the Quotation module's Custom Product picker
// reads this to offer "pick from catalog" alongside free-text entry.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const products = await listActiveProducts();
    return NextResponse.json(products);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
