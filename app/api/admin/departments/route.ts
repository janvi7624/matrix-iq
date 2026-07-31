import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { createDepartment, listDepartments } from '@/lib/departmentStore';
import { apiErrorResponse } from '@/lib/apiError';

// Base auth + admin-area gating happens in proxy.ts (matcher: /api/admin/:path*).
export async function GET() {
  try {
    const departments = await listDepartments();
    return NextResponse.json(departments);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ error: 'Department name is required' }, { status: 400 });

  try {
    const existing = await listDepartments();
    if (existing.some((d) => d.name.toLowerCase() === name.toLowerCase())) {
      return NextResponse.json({ error: 'A department with this name already exists' }, { status: 409 });
    }
    const department = await createDepartment({ name, description: typeof body?.description === 'string' ? body.description.trim() : '' }, session.username);
    return NextResponse.json(department, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
