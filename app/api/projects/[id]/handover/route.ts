import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { findProjectById } from '@/lib/projectStore';
import { projectHandoverStore } from '@/lib/projectHandoverStore';
import { findUserById } from '@/lib/userStore';
import { notifyUsers } from '@/lib/notificationStore';
import { sendProjectLifecycleEmail } from '@/lib/email/notifications';
import { db } from '@/lib/db';

// GET — list handover requests for a project
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const rows = await db.ProjectHandoverRequest.findAll({
    where: { project_id: id },
    include: [
      { model: db.User, as: 'fromUser', attributes: ['id', 'username', 'name'] },
      { model: db.User, as: 'toUser', attributes: ['id', 'username', 'name'] },
      { model: db.Project, as: 'project', attributes: ['id', 'client_name', 'company'] }
    ],
    order: [['created_at', 'DESC']]
  });

  return NextResponse.json(rows.map((r: any) => {
    const p = r.get({ plain: true });
    return {
      id: p.id,
      project_id: p.project_id,
      from_user_id: p.from_user_id,
      from_username: p.fromUser?.username ?? '',
      from_name: p.fromUser?.name ?? '',
      to_user_id: p.to_user_id,
      to_username: p.toUser?.username ?? '',
      to_name: p.toUser?.name ?? '',
      status: p.status,
      remarks: p.remarks ?? '',
      response_remarks: p.response_remarks ?? '',
      project_title: p.project?.client_name || p.project?.company || '',
      created_at: p.createdAt ?? p.created_at,
      updated_at: p.updatedAt ?? p.updated_at
    };
  }));
}

// POST — create a handover request (X requests Y to take over)
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json();
  const { toUserId, remarks } = body;

  if (!toUserId) {
    return NextResponse.json({ error: 'Please select a person to handover to' }, { status: 400 });
  }

  // Verify project exists
  const project = await findProjectById(id);
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  // Only project owner or privileged users can initiate handover
  if (project.created_by !== viewer.username && !viewer.isPrivileged) {
    return NextResponse.json({ error: 'Only the project owner or admin can initiate a handover' }, { status: 403 });
  }

  // Cannot handover to yourself
  if (toUserId === viewer.userId) {
    return NextResponse.json({ error: 'Cannot handover to yourself' }, { status: 400 });
  }

  // Check no pending handover already exists
  const existing = await projectHandoverStore.findPendingForProject(id);
  if (existing) {
    return NextResponse.json({ error: 'A handover request is already pending for this project' }, { status: 409 });
  }

  // Verify target user exists
  const toUser = await findUserById(toUserId);
  if (!toUser) {
    return NextResponse.json({ error: 'Target user not found' }, { status: 400 });
  }

  const record = await projectHandoverStore.create({
    project_id: id,
    from_user_id: viewer.userId,
    to_user_id: toUserId,
    remarks: typeof remarks === 'string' ? remarks.trim() : ''
  });

  // Notify the target user
  const projectLabel = project.client_name || project.company || 'a project';
  await notifyUsers([toUser.username], {
    title: 'Project handover request',
    body: `${viewer.name || viewer.username} wants to hand over "${projectLabel}" to you.${remarks ? ` Remarks: ${remarks}` : ''}`,
    type: 'project_handover_request',
    entityType: 'project',
    entityId: id
  });
  if (toUser.email) {
    void sendProjectLifecycleEmail({
      name: toUser.name,
      email: toUser.email,
      projectId: id,
      projectKind: 'sales',
      event: 'handover_requested',
      projectLabel,
      detail: `Requested by ${viewer.name || viewer.username}${remarks ? ` — Remarks: ${remarks}` : ''}`
    });
  }

  return NextResponse.json(record, { status: 201 });
}
