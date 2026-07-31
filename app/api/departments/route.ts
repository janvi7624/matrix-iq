import { NextResponse } from 'next/server';
import { listActiveDepartments } from '@/lib/departmentStore';
import { apiErrorResponse } from '@/lib/apiError';

// Any authenticated user (gated in proxy.ts) — feeds the Department dropdown
// on the User form and any future department-based filter.
export async function GET() {
  try {
    const departments = await listActiveDepartments();
    return NextResponse.json(departments);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
