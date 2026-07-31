import { NextRequest, NextResponse } from 'next/server';
import { deleteProduct, findProductById, updateProduct } from '@/lib/productStore';
import { apiErrorResponse } from '@/lib/apiError';

// Base auth + admin/superadmin/manager gating happens in proxy.ts (matcher: /api/admin/:path*),
// including a blanket "DELETE under /api/admin requires superadmin" rule.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  try {
    const existing = await findProductById(id);
    if (!existing) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

    const patch: Record<string, unknown> = {};
    const stringFields = ['name', 'sku', 'category', 'brand', 'description', 'unit', 'hsnSac', 'imageUrl'] as const;
    stringFields.forEach((field) => {
      if (typeof body[field] === 'string') patch[field] = body[field].trim();
    });
    const numberFields = ['defaultQty', 'basePrice', 'sellingPrice', 'taxPercent', 'discountPercent'] as const;
    numberFields.forEach((field) => {
      if (body[field] !== undefined) patch[field] = Number(body[field]) || 0;
    });
    if (body.status === 'active' || body.status === 'inactive') patch.status = body.status;

    const updated = await updateProduct(id, patch);
    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const deleted = await deleteProduct(id);
    if (!deleted) return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
