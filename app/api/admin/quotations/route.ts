import { NextRequest, NextResponse } from 'next/server';
import { searchQuotations } from '@/lib/quotationStore';

// Auth is enforced by middleware.ts (matcher: /api/admin/quotations/:path*).
export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q') || '';
  const records = searchQuotations(query);
  return NextResponse.json(records);
}
