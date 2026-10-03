import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { resolveVisibilityScope } from '@/lib/departmentScope';
import { listActiveDepartments, departmentsManagedBy } from '@/lib/departmentStore';
import { findUserNameAndDeptByUsername } from '@/lib/userStore';
import { computeDepartmentScore, ScoringDataCache, TeamMember } from '@/lib/departmentScoring';
import { apiErrorResponse } from '@/lib/apiError';
import { db } from '@/lib/db';

async function teamFor(departmentId: string): Promise<TeamMember[]> {
  const rows = await db.User.findAll({
    where: { departmentId, status: 'active' } as never,
    // `name` is needed by the Accounts scorer, whose payment-queue records
    // identify who paid by display name rather than username.
    attributes: ['id', 'username', 'name']
  });
  return rows.map((r) => ({ id: r.get('id') as string, username: r.get('username') as string, name: (r.get('name') as string) || '' }));
}

// One department's data problem must not blank the whole Department Health
// section: Promise.all rejects as a unit, so a single scorer throwing used to
// take every other gauge down with it and the dashboard rendered nothing at
// all (the section is hidden when gauges is empty). Each department is now
// scored independently and a failure degrades to that one gauge reading N/A.
// The error is logged rather than swallowed, so a real fault is still visible
// in the server output instead of silently becoming "no data".
async function safeScore(departmentName: string, team: TeamMember[], cache: ScoringDataCache) {
  try {
    return await computeDepartmentScore(departmentName, team, cache);
  } catch (error) {
    console.error(`[dashboard/health] scoring "${departmentName}" failed:`, error);
    return {
      score: 0,
      band: 'na' as const,
      breakdown: [],
      members: [],
      formula: 'This department’s health could not be calculated — see the server log.'
    };
  }
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
      // One cache shared across every department in this request — several
      // department names map to the same underlying dataset (e.g. Sales +
      // GEM - Sales, or AV + Robotics + AI), so without a shared cache each
      // of these concurrent Promise.all branches re-runs the same full-table
      // query. See lib/departmentScoring.ts's ScoringDataCache.
      const cache: ScoringDataCache = {};
      const gauges = await Promise.all(
        departments.map(async (d) => ({
          department: d.name,
          ...(await safeScore(d.name, await teamFor(d.id), cache))
        }))
      );
      return NextResponse.json({ scope: 'org', gauges });
    }

    const managed = await departmentsManagedBy(viewer.username);
    if (managed.length) {
      const cache: ScoringDataCache = {};
      const gauges = await Promise.all(
        managed.map(async (d) => ({
          department: d.name,
          ...(await safeScore(d.name, await teamFor(d.id), cache))
        }))
      );
      return NextResponse.json({ scope: 'department', gauges });
    }

    const deptInfo = await findUserNameAndDeptByUsername(viewer.username);
    const selfTeam: TeamMember[] = [{ id: viewer.userId, username: viewer.username, name: deptInfo?.name || '' }];
    const result = await safeScore(deptInfo?.department || '', selfTeam, {});
    return NextResponse.json({ scope: 'self', gauges: [{ department: deptInfo?.department || 'You', ...result }] });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
