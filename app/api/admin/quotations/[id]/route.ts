import { NextRequest, NextResponse } from 'next/server';
import { deleteQuotation } from '@/lib/quotationStore';

// Auth + admin-role enforcement happens in proxy.ts (matcher: /api/admin/:path*).
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const deleted = deleteQuotation(id);
  if (!deleted) return NextResponse.json({ error: 'Quotation not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
