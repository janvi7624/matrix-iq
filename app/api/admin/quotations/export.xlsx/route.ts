import { NextResponse } from 'next/server';
import { searchQuotations } from '@/lib/quotationStore';
import { buildQuotationsXlsxBuffer } from '@/lib/quotationXlsx';
import { apiErrorResponse } from '@/lib/apiError';

// Auth is enforced by middleware.ts (matcher: /api/admin/quotations/:path*).
export async function GET() {
  try {
    const buffer = await buildQuotationsXlsxBuffer(await searchQuotations());
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="quotations.xlsx"'
      }
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
