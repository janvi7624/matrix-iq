import { NextResponse } from 'next/server';
import { listProducts } from '@/lib/productStore';
import { buildProductsXlsxBuffer } from '@/lib/productXlsx';
import { apiErrorResponse } from '@/lib/apiError';

export async function GET() {
  try {
    const buffer = await buildProductsXlsxBuffer(await listProducts());
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="products.xlsx"'
      }
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
