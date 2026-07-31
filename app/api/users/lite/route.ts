import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { listUsers } from '@/lib/userStore';
import { apiErrorResponse } from '@/lib/apiError';

// Any authenticated user — a lightweight {username, name} list for "User
// Selector" fields in custom modules. lib/userStore's full listing lives
// behind /api/admin/users (admin-only) since it includes contact details,
// role, employee fields, etc.; this is just enough to populate a dropdown.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const users = await listUsers();
    return NextResponse.json(users.filter((u) => u.status === 'active').map((u) => ({ username: u.username, name: u.name })));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
