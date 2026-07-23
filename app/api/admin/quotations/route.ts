import { NextRequest, NextResponse } from 'next/server';
import { searchQuotations } from '@/lib/quotationStore';
import { apiErrorResponse } from '@/lib/apiError';

// Auth is enforced by middleware.ts (matcher: /api/admin/quotations/:path*).
export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams.get('q') || '';
    const records = await searchQuotations(query);
    return NextResponse.json(records);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
