import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { apiErrorResponse } from '@/lib/apiError';
import { resolveUserAdminAuthority } from '@/lib/userAdminScope';

// What the CALLER may do on the User Management screen — which roles to offer
// and which departments to allow. Purely to shape the form; the user routes
// enforce the same rules server-side regardless of what the form sends.
export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const a = await resolveUserAdminAuthority(session);
    return NextResponse.json({
      adminTier: a.adminTier,
      seesOrgWide: a.seesOrgWide,
      managedDepartmentNames: a.managedDepartmentNames,
      assignableRoleKeys: a.assignableRoleKeys
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
