import { NextResponse } from 'next/server';
import { buildQuotationsCsv } from '@/lib/quotationStore';
import { apiErrorResponse } from '@/lib/apiError';

// Auth is enforced by middleware.ts (matcher: /api/admin/quotations/:path*).
export async function GET() {
  try {
    const csv = await buildQuotationsCsv();
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="quotations.csv"'
      }
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
