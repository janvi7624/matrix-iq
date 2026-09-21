import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { listUsers } from '@/lib/userStore';
import { canActOnBehalf } from '@/lib/quotationOnBehalfAccess';
import { apiErrorResponse } from '@/lib/apiError';

// Feeds the "Prepared By" team-member picker — restricted to Khushi/Maulik
// (the only ones who can select someone other than themselves). Everyone
// else's Prepared By is locked to their own account already, so they have
// no use for this list, and it's not exposed to them.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canActOnBehalf(viewer.username)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const users = await listUsers();
    const options = users
      .filter((u) => u.status === 'active')
      .map((u) => ({ id: u.id, username: u.username, name: u.name, phone: u.phone, email: u.email }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json(options);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
