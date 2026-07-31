import { NextResponse } from 'next/server';
import { buildProductsCsv } from '@/lib/productStore';
import { apiErrorResponse } from '@/lib/apiError';

export async function GET() {
  try {
    const csv = await buildProductsCsv();
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="products.csv"'
      }
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
