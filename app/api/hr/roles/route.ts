import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { requireHrModule } from '@/lib/hrAccess';
import { listActiveRoles } from '@/lib/roleStore';
import { apiErrorResponse } from '@/lib/apiError';

// Feeds the New Employee form's role picker (components/HrEmployeesView.tsx)
// — /api/admin/roles exists but sits behind proxy.ts's /api/admin isPrivileged
// gate, which HR (a non-privileged role) can't reach. Only the non-privileged
// subset is returned: admin/superadmin (or any other role someone marks
// privileged in Role Management) is never offerable here, enforced again
// server-side in POST /api/hr/employees regardless of what this list shows.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireHrModule(viewer, 'hr-employees'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const roles = await listActiveRoles();
    return NextResponse.json(roles.filter((r) => !r.isPrivileged).map((r) => ({ key: r.key, label: r.label })));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
