import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { listForUser, markAllRead, markRead } from '@/lib/notificationStore';
import { resolveActionableNotifications } from '@/lib/notificationResolver';
import { apiErrorResponse } from '@/lib/apiError';

const DISPLAY_LIMIT = 30;

// Strictly scoped to the calling user throughout — every store function
// resolves userId from the session's own username, so there is no way to
// read or mark-read another account's notifications through this route.
//
// Fetches more rows than are actually shown, then filters down to ones with
// a real, still-valid destination (lib/notificationResolver.ts) — an
// unrecognized entity_type, or a reference to a record that's since been
// deleted, is excluded here rather than reaching the client as a dead link.
// Over-fetching (not just filtering DISPLAY_LIMIT rows) means a user whose
// most recent 30 notifications include a few stale ones still sees a full
// page of real, clickable notifications instead of an artificially short list.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const raw = await listForUser(viewer.username, DISPLAY_LIMIT * 3);
    const actionable = (await resolveActionableNotifications(raw)).slice(0, DISPLAY_LIMIT);
    const unread = actionable.filter((n) => !n.is_read).length;
    return NextResponse.json({ notifications: actionable, unreadCount: unread });
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
