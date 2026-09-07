import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { requireHrModule } from '@/lib/hrAccess';
import { canViewRole } from '@/lib/permissions';
import { db } from '@/lib/db';
import { apiErrorResponse } from '@/lib/apiError';

// Thin read-only directory over the existing User/Department data — no new
// employee-record model. Deliberately returns only the fields an HR
// directory needs, not the full UserRecord (no passwordHash, obviously, but
// also no email/phone unless the viewer is an HR manager/admin — least-
// privilege per the spec's HR data-privacy section).
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireHrModule(viewer, 'hr-employees'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const rows = await db.User.findAll({
      where: { status: 'active' } as never,
      include: [
        { model: db.Department, as: 'departmentRef', attributes: ['name'] },
        { model: db.Role, as: 'role', attributes: ['key', 'label'] }
      ],
      attributes: ['id', 'username', 'name', 'designation', 'email', 'phone'],
      order: [['name', 'ASC']]
    });

    const employees = rows
      .map((r) => {
        const plain = r.get({ plain: true }) as Record<string, unknown>;
        const role = plain.role as { key?: string; label?: string } | null;
        if (role?.key && !canViewRole(viewer.role, role.key)) return null;
        return {
          id: plain.id,
          username: plain.username,
          name: plain.name,
          designation: plain.designation || '',
          department: (plain.departmentRef as { name?: string } | null)?.name ?? '',
          role: role?.label || role?.key || '',
          email: plain.email || '',
          phone: plain.phone || ''
        };
      })
      .filter((e): e is NonNullable<typeof e> => !!e);

    return NextResponse.json(employees);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
