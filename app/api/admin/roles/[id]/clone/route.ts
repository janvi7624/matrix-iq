import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { cloneRole } from '@/lib/roleStore';
import { apiErrorResponse } from '@/lib/apiError';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const label = typeof body?.label === 'string' ? body.label.trim() : '';
  if (!label) return NextResponse.json({ error: 'New role name is required' }, { status: 400 });

  try {
    const cloned = await cloneRole(id, label, session.username);
    if (!cloned) return NextResponse.json({ error: 'Role not found' }, { status: 404 });
    return NextResponse.json(cloned, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
