import { NextRequest, NextResponse } from 'next/server';
import { deleteQuotation } from '@/lib/quotationStore';
import { apiErrorResponse } from '@/lib/apiError';

// Auth + admin-role enforcement happens in proxy.ts (matcher: /api/admin/:path*).
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const deleted = await deleteQuotation(id);
    if (!deleted) return NextResponse.json({ error: 'Quotation not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
