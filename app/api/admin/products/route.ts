import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { createProduct, listProducts, ProductInput } from '@/lib/productStore';
import { apiErrorResponse } from '@/lib/apiError';

// Base auth + admin/superadmin/manager gating happens in proxy.ts (matcher: /api/admin/:path*).
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const products = await listProducts({
      q: params.get('q') || undefined,
      category: params.get('category') || undefined,
      brand: params.get('brand') || undefined,
      status: (params.get('status') as 'active' | 'inactive' | null) || undefined
    });
    return NextResponse.json(products);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body.name !== 'string' || !body.name.trim()) {
    return NextResponse.json({ error: 'Product name is required' }, { status: 400 });
  }

  try {
    const input: ProductInput = {
      name: body.name.trim(),
      sku: typeof body.sku === 'string' ? body.sku.trim() : '',
      category: typeof body.category === 'string' ? body.category.trim() : '',
      brand: typeof body.brand === 'string' ? body.brand.trim() : '',
      description: typeof body.description === 'string' ? body.description.trim() : '',
      unit: typeof body.unit === 'string' && body.unit.trim() ? body.unit.trim() : 'Nos',
      defaultQty: Number(body.defaultQty) || 1,
      basePrice: Number(body.basePrice) || 0,
      sellingPrice: Number(body.sellingPrice) || 0,
      taxPercent: Number(body.taxPercent) || 0,
      hsnSac: typeof body.hsnSac === 'string' ? body.hsnSac.trim() : '',
      discountPercent: Number(body.discountPercent) || 0,
      imageUrl: typeof body.imageUrl === 'string' ? body.imageUrl.trim() : '',
      status: body.status === 'inactive' ? 'inactive' : 'active'
    };
    const product = await createProduct(input, session.username);
    return NextResponse.json(product, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
