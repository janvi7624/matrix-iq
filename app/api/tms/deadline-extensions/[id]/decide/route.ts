import { NextRequest, NextResponse } from 'next/server';
import { getTmsViewer, resolveTmsDeadlineTier } from '@/lib/tmsAccess';
import { canAccessTmsProjectRow, tmsProjectStore } from '@/lib/tmsProjectStore';
import { decideExtension, findById as findExtensionById, InvalidDeadlineExtensionError } from '@/lib/tmsDeadlineExtensionStore';
import { apiErrorResponse } from '@/lib/apiError';
import { logAudit } from '@/lib/auditLogStore';
import { notifyUsers } from '@/lib/notificationStore';
import { getClientIp } from '@/lib/requestIp';
import { findUserByUsername } from '@/lib/userStore';

// Approve/Reject a pending TMS deadline-extension request. Tier is
// re-resolved server-side (never trusts the client) — a 'plain' viewer can
// never decide anything; the store itself enforces which pending status a
// given tier may act on (see decideExtension's own checks).
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
    const extension = await findExtensionById(id);
    if (!extension) return NextResponse.json({ error: 'Extension request not found' }, { status: 404 });

    const project = await tmsProjectStore.findById(extension.tmsProjectId);
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    if (!canAccessTmsProjectRow(viewer, project)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const decider = await findUserByUsername(viewer.username);
    if (!decider) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const deciderTier = resolveTmsDeadlineTier(viewer);
    const decided = await decideExtension({
      extensionId: id,
      decision: body.decision,
      deciderUserId: decider.id,
      deciderTier,
      decisionRemark
    });

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'tms_project',
      entityId: extension.tmsProjectId,
      action: `Deadline extension ${body.decision === 'approve' ? 'approved' : 'rejected'}`,
      previousStatus: extension.status,
      newStatus: decided.status,
      remarks: decisionRemark,
      ip: getClientIp(request)
    });

    const requesterUser = decided.extendedByUsername ? await findUserByUsername(decided.extendedByUsername) : undefined;
    if (requesterUser && requesterUser.username !== viewer.username) {
      await notifyUsers([requesterUser.username], {
        title: `Deadline Extension ${body.decision === 'approve' ? 'Approved' : 'Rejected'}`,
        body: `"${project.name}"\n${body.decision === 'approve' ? `New deadline: ${decided.newDeadline}` : `Reason: ${decisionRemark}`}`,
        type: 'tms_project_deadline_extended',
        entityType: 'tms_project',
        entityId: extension.tmsProjectId
      });
    }

    return NextResponse.json({ extension: decided });
  } catch (error) {
    if (error instanceof InvalidDeadlineExtensionError) return NextResponse.json({ error: error.message }, { status: 400 });
    return apiErrorResponse(error);
  }
}
