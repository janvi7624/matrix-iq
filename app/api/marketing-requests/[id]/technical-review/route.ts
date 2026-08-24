import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { marketingRequestStore } from '@/lib/marketingRequestStore';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { notifyUsers } from '@/lib/notificationStore';
import { sendMarketingRequestLifecycleEmail } from '@/lib/email/notifications';
import { findUserByUsername } from '@/lib/userStore';
import { getAppConfig } from '@/lib/appConfigStore';
import { MarketingRequestRecord } from '@/lib/types';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const action = body.action as 'approve' | 'request_changes' | undefined;
  if (action !== 'approve' && action !== 'request_changes') {
    return NextResponse.json({ error: 'Valid action (approve or request_changes) is required' }, { status: 400 });
  }

  const remarks = typeof body.remarks === 'string' ? body.remarks.trim() : '';
  if (action === 'request_changes' && !remarks) {
    return NextResponse.json({ error: 'Please provide remarks detailing the requested technical changes' }, { status: 400 });
  }

  try {
    const records = await marketingRequestStore.list(viewer.username, true);
    const existing = records.find((r) => r.id === id);
    if (!existing) return NextResponse.json({ error: 'Marketing request not found' }, { status: 404 });

    // Allow the assigned technical member, or any user with role 'engineer' or privileged accounts
    const isAssignedTechnical = existing.technical_member_username === viewer.username;
    const isTechnicalRoleOrPrivileged = viewer.role === 'engineer' || viewer.isPrivileged;

    if (!isAssignedTechnical && !isTechnicalRoleOrPrivileged) {
      return NextResponse.json(
        { error: 'Forbidden — only the assigned Technical member or a Technical team member can review this request' },
        { status: 403 }
      );
    }

    const newStatus = action === 'approve' ? 'technical_approved' : 'tech_changes_requested';
    const decision = action === 'approve' ? 'approved' : 'changes_requested';

    const patch: Partial<MarketingRequestRecord> = {
      status: newStatus,
      technical_review_decision: decision,
      technical_remarks: remarks,
      technical_reviewed_by: viewer.username,
      technical_reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const updated = await marketingRequestStore.update(id, patch);

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'marketing_request',
      entityId: id,
      action: action === 'approve' ? 'Technical review approved' : 'Technical changes requested',
      previousStatus: existing.status,
      newStatus,
      remarks,
      ip: getClientIp(request)
    });

    // Notify marketing member (assignee or Marketing Owner)
    const appConfig = await getAppConfig();
    const marketingTarget = existing.assigned_to || appConfig.marketingOwnerUsername;
    if (marketingTarget && marketingTarget !== viewer.username) {
      await notifyUsers([marketingTarget], {
        title: action === 'approve' ? 'Technical team approved request' : 'Technical team requested changes',
        body:
          action === 'approve'
            ? `${viewer.username} approved "${existing.title}". You can now complete final delivery to ${existing.created_by}.`
            : `${viewer.username} requested changes on "${existing.title}": ${remarks}`,
        type: action === 'approve' ? 'marketing_technical_approved' : 'marketing_technical_changes_requested',
        entityType: 'marketing_request',
        entityId: id
      });
      const marketingUser = await findUserByUsername(marketingTarget);
      if (marketingUser?.email) {
        void sendMarketingRequestLifecycleEmail({
          name: marketingUser.name,
          email: marketingUser.email,
          event: action === 'approve' ? 'technical_approved' : 'technical_changes_requested',
          title: existing.title,
          detail: action === 'approve' ? `Approved by ${viewer.username}` : `${viewer.username}: ${remarks}`
        });
      }
    }

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
