import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { canAccessProject, findProjectById, resolveProjectDeadlineTier } from '@/lib/projectStore';
import { decideExtension, findById as findExtensionById, InvalidDeadlineExtensionError } from '@/lib/projectDeadlineExtensionStore';
import { apiErrorResponse } from '@/lib/apiError';
import { logAudit } from '@/lib/auditLogStore';
import { notifyUsers } from '@/lib/notificationStore';
import { getClientIp } from '@/lib/requestIp';
import { findUserByUsername } from '@/lib/userStore';

// Approve/Reject a pending Sales Project deadline-extension request —
// mirrors app/api/tms/deadline-extensions/[id]/decide/route.ts exactly.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || (body.decision !== 'approve' && body.decision !== 'reject')) {
    return NextResponse.json({ error: 'A valid decision (approve/reject) is required' }, { status: 400 });
  }
  const decisionRemark = typeof body.decisionRemark === 'string' ? body.decisionRemark.trim() : '';

  try {
    const extension = await findExtensionById(id);
    if (!extension) return NextResponse.json({ error: 'Extension request not found' }, { status: 404 });

    const project = await findProjectById(extension.projectId);
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    if (!(await canAccessProject(viewer.username, project))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const decider = await findUserByUsername(viewer.username);
    if (!decider) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const deciderTier = await resolveProjectDeadlineTier(viewer);
    const decided = await decideExtension({
      extensionId: id,
      decision: body.decision,
      deciderUserId: decider.id,
      deciderTier,
      decisionRemark
    });

    const label = project.client_name || project.company || extension.projectId;
    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'project',
      entityId: extension.projectId,
      action: `Deadline extension ${body.decision === 'approve' ? 'approved' : 'rejected'}`,
      previousStatus: extension.status,
      newStatus: decided.status,
      remarks: decisionRemark,
      ip: getClientIp(request)
    });

    if (decided.requestedByUsername && decided.requestedByUsername !== viewer.username) {
      await notifyUsers([decided.requestedByUsername], {
        title: `Deadline Extension ${body.decision === 'approve' ? 'Approved' : 'Rejected'}`,
        body: `"${label}"\n${body.decision === 'approve' ? `New deadline: ${decided.newDeadline}` : `Reason: ${decisionRemark}`}`,
        type: 'project_deadline_extended',
        entityType: 'project',
        entityId: extension.projectId
      });
    }

    return NextResponse.json({ extension: decided });
  } catch (error) {
    if (error instanceof InvalidDeadlineExtensionError) return NextResponse.json({ error: error.message }, { status: 400 });
    return apiErrorResponse(error);
  }
}
