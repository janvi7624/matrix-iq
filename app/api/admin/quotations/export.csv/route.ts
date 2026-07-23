import { NextResponse } from 'next/server';
import { buildQuotationsCsv } from '@/lib/quotationStore';

// Auth is enforced by middleware.ts (matcher: /api/admin/quotations/:path*).
export async function GET() {
  const csv = buildQuotationsCsv();
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="quotations.csv"'
    }
  });
}
