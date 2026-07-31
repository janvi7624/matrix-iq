import { NextRequest, NextResponse } from 'next/server';
import { bulkUpdatePrices } from '@/lib/productStore';
import { apiErrorResponse } from '@/lib/apiError';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.ids) || body.ids.length === 0) {
    return NextResponse.json({ error: 'Select at least one product' }, { status: 400 });
  }
  if (body.field !== 'basePrice' && body.field !== 'sellingPrice') {
    return NextResponse.json({ error: 'field must be basePrice or sellingPrice' }, { status: 400 });
  }
  if (body.mode !== 'percent' && body.mode !== 'flat') {
    return NextResponse.json({ error: 'mode must be percent or flat' }, { status: 400 });
  }

  try {
    const count = await bulkUpdatePrices({
      ids: body.ids.filter((id: unknown): id is string => typeof id === 'string'),
      field: body.field,
      mode: body.mode,
      value: Number(body.value) || 0
    });
    return NextResponse.json({ updated: count });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
