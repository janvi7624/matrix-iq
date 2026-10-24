import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { listUsers } from '@/lib/userStore';
import { apiErrorResponse } from '@/lib/apiError';
import { canViewRole } from '@/lib/permissions';
import { listPartnerUserIds } from '@/lib/partnerUserStore';

// Any authenticated user — a lightweight {username, name} list for "User
// Selector" fields in custom modules. lib/userStore's full listing lives
// behind /api/admin/users (admin-only) since it includes contact details,
// role, employee fields, etc.; this is just enough to populate a dropdown.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    // External partner logins are excluded: this list populates internal
    // people-pickers (custom module person fields, assignment dropdowns), and
    // an external contact must never be assignable as the internal owner of
    // internal work. See listPartnerUserIds.
    const [users, partnerUserIds] = await Promise.all([listUsers(), listPartnerUserIds()]);
    return NextResponse.json(
      users
        .filter((u) => u.status === 'active' && !partnerUserIds.has(u.id) && canViewRole(viewer.role, u.role))
        .map((u) => ({ id: u.id, username: u.username, name: u.name }))
        .sort((a, b) => a.name.localeCompare(b.name))
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}
