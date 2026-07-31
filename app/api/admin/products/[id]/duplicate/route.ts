import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { duplicateProduct } from '@/lib/productStore';
import { apiErrorResponse } from '@/lib/apiError';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id } = await params;
    const copy = await duplicateProduct(id, session.username);
    if (!copy) return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    return NextResponse.json(copy, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
