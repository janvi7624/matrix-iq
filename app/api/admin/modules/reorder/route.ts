import { NextRequest, NextResponse } from 'next/server';
import { reorderModules } from '@/lib/moduleConfigStore';
import { apiErrorResponse } from '@/lib/apiError';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.orderedIds)) {
    return NextResponse.json({ error: 'orderedIds must be an array' }, { status: 400 });
  }

  try {
    await reorderModules(body.orderedIds.filter((id: unknown): id is string => typeof id === 'string'));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
