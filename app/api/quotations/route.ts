import { NextRequest, NextResponse } from 'next/server';
import { createQuotation } from '@/lib/quotationStore';

// Listing/searching quotations requires admin login — see /api/admin/quotations.
// This route only accepts POST, used by the calculator to log a new quotation.
export async function POST(request: NextRequest) {
  const body = await request.json();
  const record = createQuotation(body);
  return NextResponse.json(record, { status: 201 });
}
