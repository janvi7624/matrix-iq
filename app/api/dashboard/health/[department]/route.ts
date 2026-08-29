import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { resolveVisibilityScope } from '@/lib/departmentScope';
import { listActiveDepartments, departmentsManagedBy, listDepartmentManagers } from '@/lib/departmentStore';
import { findUserNameAndDeptByUsername } from '@/lib/userStore';
import { computeDepartmentScore, TeamMember, BAND_THRESHOLDS } from '@/lib/departmentScoring';
import { apiErrorResponse } from '@/lib/apiError';
import { db } from '@/lib/db';

interface TeamRow extends TeamMember {
  name: string;
  designation: string;
}

async function teamFor(departmentId: string): Promise<TeamRow[]> {
  const rows = await db.User.findAll({
    where: { departmentId, status: 'active' } as never,
    attributes: ['id', 'username', 'name', 'designation']
  });
  return rows.map((r) => ({
    id: r.get('id') as string,
    username: r.get('username') as string,
    name: (r.get('name') as string) || '',
    designation: (r.get('designation') as string) || ''
  }));
}

// Full detail for ONE department's health gauge — the per-member scores behind
// the department average, the roster, the department's managers, and a
// plain-language description of the formula.
//
// Deliberately a separate endpoint rather than extra fields on
// /api/dashboard/health: that route returns a gauge per department, and
// inlining every member of every department would multiply the dashboard's
// first-paint payload for data nobody sees until they open a gauge.
//
// Authorisation mirrors the gauge list exactly, so this can't be used to read
// a department the caller isn't already allowed to see a gauge for:
//   • org-wide viewers  -> any active department
//   • department manager -> only the departments they manage
//   • everyone else      -> only their own department, and only their own row
export async function GET(request: NextRequest, { params }: { params: Promise<{ department: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { department: rawDepartment } = await params;
    const departmentName = decodeURIComponent(rawDepartment);

    const scope = await resolveVisibilityScope(viewer.username);
    const departments = await listActiveDepartments();
    const match = departments.find((d) => d.name === departmentName);
    if (!match) return NextResponse.json({ error: 'Department not found' }, { status: 404 });

    let team: TeamRow[];
    let selfOnly = false;

    if (scope.seesOrgWide) {
      team = await teamFor(match.id);
    } else {
      const managed = await departmentsManagedBy(viewer.username);
      if (managed.some((d) => d.id === match.id)) {
        team = await teamFor(match.id);
      } else {
        // Not org-wide and not a manager of this department — the only
        // department they may inspect is their own, and only their own row in
        // it. Anything else is a 403 rather than a filtered-empty response, so
        // the client can tell "not allowed" from "nothing to show".
        const deptInfo = await findUserNameAndDeptByUsername(viewer.username);
        if (deptInfo?.department !== departmentName) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        selfOnly = true;
        const roster = await teamFor(match.id);
        const me = roster.find((r) => r.id === viewer.userId);
        team = me ? [me] : [{ id: viewer.userId, username: viewer.username, name: '', designation: '' }];
      }
    }

    const result = await computeDepartmentScore(departmentName, team);
    const managersByDepartment = await listDepartmentManagers();

    // Attach display names to each scored member. computeDepartmentScore sorts
    // its members, so join by id rather than assuming positional order.
    const byId = new Map(team.map((t) => [t.id, t]));
    const members = result.members.map((m) => ({
      ...m,
      name: byId.get(m.id)?.name || m.username,
      designation: byId.get(m.id)?.designation || ''
    }));

    return NextResponse.json({
      department: departmentName,
      description: match.description || '',
      score: result.score,
      band: result.band,
      breakdown: result.breakdown,
      formula: result.formula,
      thresholds: BAND_THRESHOLDS,
      teamSize: team.length,
      scoredCount: members.filter((m) => m.score !== null).length,
      managers: selfOnly ? [] : (managersByDepartment[departmentName] || []),
      selfOnly,
      members
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
