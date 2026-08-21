import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { resolveVisibilityScope } from '@/lib/departmentScope';
import { listActiveDepartments, departmentsManagedBy } from '@/lib/departmentStore';
import { findUserNameAndDeptByUsername } from '@/lib/userStore';
import { computeDepartmentScore, TeamMember } from '@/lib/departmentScoring';
import { apiErrorResponse } from '@/lib/apiError';
import { db } from '@/lib/db';

async function teamFor(departmentId: string): Promise<TeamMember[]> {
  const rows = await db.User.findAll({
    where: { departmentId, status: 'active' } as never,
    attributes: ['id', 'username']
  });
  return rows.map((r) => ({ id: r.get('id') as string, username: r.get('username') as string }));
}

// Dashboard traffic-light gauges: an org-wide viewer gets one gauge per
// active department (that department's team average); a department manager
// gets one gauge for just the department(s) they manage; everyone else gets
// one personal gauge (the same per-department formula, run over a team of
// just themselves). See lib/departmentScoring.ts for the actual formulas.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const scope = await resolveVisibilityScope(viewer.username);

    if (scope.seesOrgWide) {
      const departments = await listActiveDepartments();
      const gauges = await Promise.all(
        departments.map(async (d) => ({
          department: d.name,
          ...(await computeDepartmentScore(d.name, await teamFor(d.id)))
        }))
      );
      return NextResponse.json({ scope: 'org', gauges });
    }

    const managed = await departmentsManagedBy(viewer.username);
    if (managed.length) {
      const gauges = await Promise.all(
        managed.map(async (d) => ({
          department: d.name,
          ...(await computeDepartmentScore(d.name, await teamFor(d.id)))
        }))
      );
      return NextResponse.json({ scope: 'department', gauges });
    }

    const deptInfo = await findUserNameAndDeptByUsername(viewer.username);
    const selfTeam: TeamMember[] = [{ id: viewer.userId, username: viewer.username }];
    const result = await computeDepartmentScore(deptInfo?.department || '', selfTeam);
    return NextResponse.json({ scope: 'self', gauges: [{ department: deptInfo?.department || 'You', ...result }] });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
