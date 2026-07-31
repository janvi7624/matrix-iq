import { NextRequest, NextResponse } from 'next/server';
import { reorderDepartments } from '@/lib/departmentStore';
import { apiErrorResponse } from '@/lib/apiError';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.orderedIds)) return NextResponse.json({ error: 'orderedIds array is required' }, { status: 400 });

  try {
    await reorderDepartments(body.orderedIds.filter((id: unknown): id is string => typeof id === 'string'));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
