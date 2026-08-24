import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { appendProjectTimeline, findProjectById } from '@/lib/projectStore';
import { projectHandoverStore } from '@/lib/projectHandoverStore';
import { notifyUsers } from '@/lib/notificationStore';
import { sendProjectLifecycleEmail } from '@/lib/email/notifications';
import { findUserByUsername } from '@/lib/userStore';
import { db } from '@/lib/db';

// POST — respond to a handover request (approve/reject)
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: projectId } = await params;
  const body = await request.json();
  const { handoverRequestId, approved, responseRemarks } = body;

  if (!handoverRequestId) {
    return NextResponse.json({ error: 'Missing handoverRequestId' }, { status: 400 });
  }

  const handover = await projectHandoverStore.findById(handoverRequestId);
  if (!handover) {
    return NextResponse.json({ error: 'Handover request not found' }, { status: 404 });
  }

  if (handover.status !== 'pending') {
    return NextResponse.json({ error: 'This handover request has already been responded to' }, { status: 400 });
  }

  // Only the target user can respond
  if (handover.to_user_id !== viewer.userId && !viewer.isPrivileged) {
    return NextResponse.json({ error: 'Only the intended recipient can respond to this request' }, { status: 403 });
  }

  const status = approved ? 'approved' : 'rejected';
  const remarks = typeof responseRemarks === 'string' ? responseRemarks.trim() : '';

  const updated = await projectHandoverStore.respond(handoverRequestId, status, remarks);

  if (approved) {
    // Transfer project ownership
    const project = await findProjectById(projectId);
    if (project) {
      // Update created_by (ownership) and sales_person directly since created_by isn't in the FIELDS list
      await db.Project.update(
        { created_by: handover.to_user_id, sales_person: handover.to_username },
        { where: { id: projectId } }
      );

      // Add timeline event
      await appendProjectTimeline(projectId, {
        by: viewer.username,
        stage: project.stage,
        label: `Project handed over from ${handover.from_name || handover.from_username} to ${handover.to_name || handover.to_username}`
      });
    }

    // Notify the original owner that handover was approved
    await notifyUsers([handover.from_username], {
      title: 'Project handover approved',
      body: `${handover.to_name || handover.to_username} accepted the handover of "${handover.project_title}".`,
      type: 'project_handover_approved',
      entityType: 'project',
      entityId: projectId
    });
    const fromUser = await findUserByUsername(handover.from_username);
    if (fromUser?.email) {
      void sendProjectLifecycleEmail({
        name: fromUser.name,
        email: fromUser.email,
        projectId,
        projectKind: 'sales',
        event: 'handover_approved',
        projectLabel: handover.project_title,
        detail: `Accepted by ${handover.to_name || handover.to_username}`
      });
    }
  } else {
    // Notify the original owner that handover was rejected
    await notifyUsers([handover.from_username], {
      title: 'Project handover declined',
      body: `${handover.to_name || handover.to_username} declined the handover of "${handover.project_title}".${remarks ? ` Reason: ${remarks}` : ''}`,
      type: 'project_handover_rejected',
      entityType: 'project',
      entityId: projectId
    });
    const fromUser = await findUserByUsername(handover.from_username);
    if (fromUser?.email) {
      void sendProjectLifecycleEmail({
        name: fromUser.name,
        email: fromUser.email,
        projectId,
        projectKind: 'sales',
        event: 'handover_rejected',
        projectLabel: handover.project_title,
        detail: `Declined by ${handover.to_name || handover.to_username}${remarks ? ` — Reason: ${remarks}` : ''}`
      });
    }
  }

  return NextResponse.json(updated);
}
