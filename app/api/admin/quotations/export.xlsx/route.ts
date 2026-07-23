import { NextResponse } from 'next/server';
import { searchQuotations } from '@/lib/quotationStore';
import { buildQuotationsXlsxBuffer } from '@/lib/quotationXlsx';

// Auth is enforced by middleware.ts (matcher: /api/admin/quotations/:path*).
export async function GET() {
  const buffer = await buildQuotationsXlsxBuffer(searchQuotations());
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="quotations.xlsx"'
    }
  });
}
