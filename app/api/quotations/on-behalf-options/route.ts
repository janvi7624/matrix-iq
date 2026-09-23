import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { findUserById, listUsers } from '@/lib/userStore';
import { canActOnBehalf } from '@/lib/quotationOnBehalfAccess';
import { findLinkedProjectOwner } from '@/lib/quotationOnBehalf';
import { isTechnicalRole } from '@/lib/technicalRoles';
import { apiErrorResponse } from '@/lib/apiError';
import { UserRecord } from '@/lib/types';

function toOption(u: Pick<UserRecord, 'id' | 'username' | 'name' | 'phone' | 'email'>) {
  return { id: u.id, username: u.username, name: u.name, phone: u.phone, email: u.email };
}

// Feeds the "Prepared By" team-member picker — restricted to Khushi/Maulik
// (the only ones who can select anyone other than themselves). Everyone
// else's Prepared By is locked to their own account already, so they have
// no use for this list, and it's not exposed to them. The one exception is
// technical staff with ?projectId=: they get [self, that project's sales
// owner] (same narrow rule resolvePreparedBy enforces), or [] when the
// project has no owner they could pick.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!canActOnBehalf(viewer.username)) {
    if (!isTechnicalRole(viewer.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const projectId = request.nextUrl.searchParams.get('projectId')?.trim() || '';
    try {
      const owner = projectId ? await findLinkedProjectOwner(viewer.username, projectId) : undefined;
      if (!owner || owner.id === viewer.userId) return NextResponse.json([]);
      const self = await findUserById(viewer.userId);
      if (!self) return NextResponse.json([]);
      return NextResponse.json([toOption(self), toOption(owner)]);
    } catch (error) {
      return apiErrorResponse(error);
    }
  }

  try {
    const users = await listUsers();
    const options = users
      .filter((u) => u.status === 'active')
      .map(toOption)
      .sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json(options);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
