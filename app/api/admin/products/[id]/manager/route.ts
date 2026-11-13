import { NextRequest, NextResponse } from 'next/server';
import { assignProductManager } from '@/lib/productStore';
import { isUuid } from '@/lib/db';
import { apiErrorResponse } from '@/lib/apiError';

// "Add current product to manager" — reassigns an EXISTING product to a
// different Product Manager, independent of who originally created it
// (products.createdBy never changes; this writes products.managerId).
// Base auth + admin/superadmin/manager gating happens in proxy.ts.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const managerId = body?.managerId;
  if (managerId !== null && !isUuid(managerId)) {
    return NextResponse.json({ error: 'A managerId (or null to clear it) is required' }, { status: 400 });
  }

  try {
    const updated = await assignProductManager(id, managerId);
    if (!updated) return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
