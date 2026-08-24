import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { projectHandoverStore } from '@/lib/projectHandoverStore';
import { notifyUsers } from '@/lib/notificationStore';
import { sendProjectLifecycleEmail } from '@/lib/email/notifications';
import { findUserByUsername } from '@/lib/userStore';

// POST — sender cancels a pending handover request
export async function POST(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { handoverRequestId } = body;

  if (!handoverRequestId) {
    return NextResponse.json({ error: 'Missing handoverRequestId' }, { status: 400 });
  }

  const handover = await projectHandoverStore.findById(handoverRequestId);
  if (!handover) {
    return NextResponse.json({ error: 'Handover request not found' }, { status: 404 });
  }

  if (handover.status !== 'pending') {
    return NextResponse.json({ error: 'This request has already been responded to' }, { status: 400 });
  }

  // Only the sender can cancel
  if (handover.from_user_id !== viewer.userId && !viewer.isPrivileged) {
    return NextResponse.json({ error: 'Only the sender can cancel this request' }, { status: 403 });
  }

  const updated = await projectHandoverStore.respond(handoverRequestId, 'cancelled', '');

  // Notify the recipient that the request was cancelled
  await notifyUsers([handover.to_username], {
    title: 'Handover request cancelled',
    body: `${viewer.name || viewer.username} cancelled the handover request for "${handover.project_title}".`,
    type: 'project_handover_cancelled',
    entityType: 'project',
    entityId: handover.project_id
  });
  const toUser = await findUserByUsername(handover.to_username);
  if (toUser?.email) {
    void sendProjectLifecycleEmail({
      name: toUser.name,
      email: toUser.email,
      projectId: handover.project_id,
      projectKind: 'sales',
      event: 'handover_cancelled',
      projectLabel: handover.project_title,
      detail: `Cancelled by ${viewer.name || viewer.username}`
    });
  }

  return NextResponse.json(updated);
}
