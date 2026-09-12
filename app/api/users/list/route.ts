import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { db } from '@/lib/db';
import { Model } from 'sequelize';
import { canViewRole } from '@/lib/permissions';

// Sourced from db.Sequelize (the exact class the actual connection/models
// were built from) rather than a separate top-level `import { Op } from
// 'sequelize'` — see the fn/col/where fix in lib/userStore.ts for why: some
// production bundling setups end up with two distinct copies of the
// sequelize package, and symbols/instances from the "wrong" copy aren't
// recognized by the query generator built from the other one.
// `Sequelize.Op` is a real runtime static (sequelize/lib/sequelize.js sets
// it), just missing from the package's own .d.ts — hence the cast.
const { Op } = db.Sequelize as unknown as { Op: Record<string, symbol> };

// Lightweight user list for dropdowns (handover, assignment, etc.)
// ?scope=handover  → returns only users the viewer is allowed to hand projects to:
//                    Sales dept → Technical dept users only
//                    All others → same department users only
// No scope         → returns all active users (id, username, name, department)
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const scope = request.nextUrl.searchParams.get('scope');

  // Build where clause
  const where: Record<string, unknown> = { status: 'active' };

  if (scope === 'handover') {
    // Look up the viewer's department
    const viewerUser = await db.User.findOne({
      where: { username: viewer.username } as never,
      attributes: ['id', 'departmentId'],
      include: [{ model: db.Department, as: 'departmentRef', attributes: ['id', 'name'] }]
    });

    const viewerDept = (viewerUser?.get({ plain: true }) as any)?.departmentRef?.name?.toLowerCase() || '';
    const viewerDeptId = (viewerUser?.get({ plain: true }) as any)?.departmentId;

    // Technical departments: Technical, AI, AV, Robotics
    const TECHNICAL_DEPT_NAMES = ['technical', 'ai', 'av', 'robotics'];

    if (viewerDept.includes('sales')) {
      // Sales → show Sales + all technical department users
      const allowedDepts = await db.Department.findAll({
        where: {
          [Op.or]: [
            db.Sequelize.where(db.Sequelize.fn('lower', db.Sequelize.col('name')), { [Op.like]: '%sales%' }),
            db.Sequelize.where(db.Sequelize.fn('lower', db.Sequelize.col('name')), { [Op.in]: TECHNICAL_DEPT_NAMES })
          ]
        } as never,
        attributes: ['id', 'name']
      });
      const allowedIds = allowedDepts.map((d: any) => d.get('id'));
      if (allowedIds.length > 0) {
        where.departmentId = { [Op.in]: allowedIds };
      }
    } else if (viewerDeptId) {
      // Same department only
      where.departmentId = viewerDeptId;
    }

    // Exclude the viewer themselves
    where.username = { [Op.ne]: viewer.username };
  }

  const rows = await db.User.findAll({
    where: where as never,
    attributes: ['id', 'username', 'name', 'department'],
    include: [
      { model: db.Department, as: 'departmentRef', attributes: ['id', 'name'] },
      { model: db.Role, as: 'role', attributes: ['key'] }
    ],
    order: [['name', 'ASC']]
  });

  const plainRows = rows.map((r: Model) => r.get({ plain: true }) as Record<string, unknown>);
  return NextResponse.json(
    plainRows
      // Superadmin accounts never appear in an assignment/handover dropdown
      // for anyone but another superadmin — see lib/permissions.ts's canViewRole.
      .filter((plain) => canViewRole(viewer.role, (plain.role as { key?: string } | null)?.key ?? ''))
      .map((plain) => ({
        id: plain.id,
        username: plain.username,
        name: plain.name || plain.username,
        department: (plain.departmentRef as { name?: string } | null)?.name || plain.department || ''
      }))
  );
}
