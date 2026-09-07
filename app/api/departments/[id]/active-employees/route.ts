import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { listActiveEmployeesForDepartment } from '@/lib/departmentEmployeeStore';
import { apiErrorResponse } from '@/lib/apiError';

// Backs the Department -> Employee cascading dropdown used by both Admin
// Task Assignment and the HR task workspace. Any authenticated viewer may
// call this (it's just an active-employee lookup, same visibility a
// PersonPicker would already show) — the actual task-assignment permission
// is enforced on the create routes, not here.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    const employees = await listActiveEmployeesForDepartment(id);
    return NextResponse.json(employees);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
