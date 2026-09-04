import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { resolveVisibilityScope } from '@/lib/departmentScope';
import { db } from '@/lib/db';
import { apiErrorResponse } from '@/lib/apiError';

// The employee-exit picker list: active employees within the viewer's own
// visibility scope (org-wide sees everyone, a department manager sees only
// their own department's active roster) — same authorization pattern as
// app/api/dashboard/health/[department]/route.ts, not the Sales-specific
// canManageTargets gate (Employee Exit is a general department-manager
// action, not a Sales-only one).
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const scope = await resolveVisibilityScope(viewer.username);
    if (!scope.seesOrgWide && (scope.scopedUserIds ?? []).length <= 1) {
      // Manages nobody but themself — nothing to offer as an "exiting employee" pick.
      return NextResponse.json({ candidates: [] });
    }

    const where: Record<string, unknown> = { status: 'active' };
    if (!scope.seesOrgWide) where.id = scope.scopedUserIds ?? [];

    const rows = await db.User.findAll({
      where: where as never,
      include: [{ model: db.Department, as: 'departmentRef', attributes: ['name'] }],
      attributes: ['id', 'username', 'name', 'designation'],
      order: [['name', 'ASC']]
    });
    const candidates = rows.map((r) => {
      const p = r.get({ plain: true }) as Record<string, unknown>;
      const dept = p.departmentRef as { name?: string } | null;
      return { id: p.id as string, username: p.username as string, name: (p.name as string) || (p.username as string), department: dept?.name ?? '', designation: (p.designation as string) ?? '' };
    });
    return NextResponse.json({ candidates });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
