import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { listForUser, markAllRead, markRead, unreadCount } from '@/lib/notificationStore';
import { apiErrorResponse } from '@/lib/apiError';

// Strictly scoped to the calling user throughout — every store function
// resolves userId from the session's own username, so there is no way to
// read or mark-read another account's notifications through this route.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const [notifications, unread] = await Promise.all([listForUser(viewer.username), unreadCount(viewer.username)]);
    return NextResponse.json({ notifications, unreadCount: unread });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  try {
    if (body?.markAll) {
      await markAllRead(viewer.username);
      return NextResponse.json({ ok: true });
    }
    const id = typeof body?.id === 'string' ? body.id : '';
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    const ok = await markRead(id, viewer.username);
    if (!ok) return NextResponse.json({ error: 'Notification not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
