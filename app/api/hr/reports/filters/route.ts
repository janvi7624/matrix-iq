import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { requireHrModule } from '@/lib/hrAccess';
import { apiErrorResponse } from '@/lib/apiError';
import { db } from '@/lib/db';

// Just enough to populate the report's Department/Employee pickers, gated on
// the report module itself — the HR directory endpoint can't be reused for
// this because it sits behind a different module key (hr-employees), which a
// reports-only viewer may not have.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireHrModule(viewer, 'hr-reports'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const rows = await db.User.findAll({
      where: { status: 'active' } as never,
      include: [{ model: db.Department, as: 'departmentRef', attributes: ['name'] }],
      attributes: ['id', 'name', 'username', 'employeeId'],
      order: [['name', 'ASC']]
    });

    const employees = rows.map((row) => {
      const plain = row.get({ plain: true }) as Record<string, unknown>;
      const dept = plain.departmentRef as Record<string, unknown> | undefined;
      return {
        id: plain.id as string,
        name: (plain.name as string) || (plain.username as string),
        employeeId: (plain.employeeId as string) || '',
        department: (dept?.name as string) || ''
      };
    });

    const departments = [...new Set(employees.map((e) => e.department).filter(Boolean))].sort((a, b) => a.localeCompare(b));

    return NextResponse.json({ employees, departments });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
