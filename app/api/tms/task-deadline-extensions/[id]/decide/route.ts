import { NextRequest, NextResponse } from 'next/server';
import { getTmsViewer, resolveTmsDeadlineTier } from '@/lib/tmsAccess';
import { canAccessTask, tmsTaskStore } from '@/lib/tmsTaskStore';
import {
  decideTaskExtension,
  findById as findTaskExtensionById,
  InvalidTaskDeadlineExtensionError
} from '@/lib/tmsTaskDeadlineExtensionStore';
import { apiErrorResponse } from '@/lib/apiError';
import { logAudit } from '@/lib/auditLogStore';
import { notifyUsers } from '@/lib/notificationStore';
import { getClientIp } from '@/lib/requestIp';
import { findUserByUsername } from '@/lib/userStore';

// Approve/Reject a pending TMS TASK deadline-extension request. Mirrors
// app/api/tms/deadline-extensions/[id]/decide for the project-level flow.
//
// Tier is re-resolved server-side and never read from the client: a 'plain'
// viewer can decide nothing, and which pending status a given tier may act on
// is enforced inside decideTaskExtension rather than here, so the rule lives
// in one place with the transaction that depends on it.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getTmsViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || (body.decision !== 'approve' && body.decision !== 'reject')) {
    return NextResponse.json({ error: 'A valid decision (approve/reject) is required' }, { status: 400 });
  }
  const decisionRemark = typeof body.decisionRemark === 'string' ? body.decisionRemark.trim() : '';

  try {
    const extension = await findTaskExtensionById(id);
    if (!extension) return NextResponse.json({ error: 'Extension request not found' }, { status: 404 });

    const task = await tmsTaskStore.findById(extension.taskId);
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    if (!(await canAccessTask(viewer, task))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const decider = await findUserByUsername(viewer.username);
    if (!decider) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const deciderTier = resolveTmsDeadlineTier(viewer);
    const decided = await decideTaskExtension({
      extensionId: id,
      decision: body.decision,
      deciderUserId: decider.id,
      deciderTier,
      decisionRemark
    });

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'tms_task',
      entityId: extension.taskId,
      action: `Task deadline extension ${body.decision === 'approve' ? 'approved' : 'rejected'}`,
      previousStatus: extension.status,
      newStatus: decided.status,
      remarks: decisionRemark,
      ip: getClientIp(request)
    });

    const requesterUser = decided.extendedByUsername ? await findUserByUsername(decided.extendedByUsername) : undefined;
    if (requesterUser && requesterUser.username !== viewer.username) {
      await notifyUsers([requesterUser.username], {
        title: `Task Deadline Extension ${body.decision === 'approve' ? 'Approved' : 'Rejected'}`,
        body: `"${task.name}"\n${body.decision === 'approve' ? `New deadline: ${decided.newDeadline}` : `Reason: ${decisionRemark}`}`,
        type: 'tms_task_deadline_extended',
        entityType: 'tms_task',
        entityId: extension.taskId
      });
    }

    const updated = await tmsTaskStore.findById(extension.taskId);
    return NextResponse.json({ extension: decided, task: updated });
  } catch (error) {
    if (error instanceof InvalidTaskDeadlineExtensionError) return NextResponse.json({ error: error.message }, { status: 400 });
    return apiErrorResponse(error);
  }
}
