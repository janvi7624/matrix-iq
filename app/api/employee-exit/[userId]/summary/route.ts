import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { resolveVisibilityScope } from '@/lib/departmentScope';
import { findUserById } from '@/lib/userStore';
import { getAssignedWorkSummary, listActiveEmployeesExcept } from '@/lib/employeeExitStore';
import { apiErrorResponse } from '@/lib/apiError';

export async function GET(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { userId } = await params;

  try {
    const scope = await resolveVisibilityScope(viewer.username);
    if (!scope.seesOrgWide && !(scope.scopedUserIds ?? []).includes(userId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const employee = await findUserById(userId);
    if (!employee) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });

    const [work, eligibleReplacements] = await Promise.all([
      getAssignedWorkSummary(userId),
      listActiveEmployeesExcept(userId, scope.seesOrgWide ? null : scope.scopedUserIds)
    ]);

    return NextResponse.json({
      employee: { id: employee.id, username: employee.username, name: employee.name, department: employee.department, designation: employee.designation },
      eligibleReplacements,
      ...work
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
