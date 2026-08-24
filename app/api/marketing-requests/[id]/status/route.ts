import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { marketingRequestStore } from '@/lib/marketingRequestStore';
import { isMarketingManager, isModuleActionAllowed } from '@/lib/permissions';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { notifyUsers } from '@/lib/notificationStore';
import { sendMarketingRequestLifecycleEmail } from '@/lib/email/notifications';
import { findUserByUsername } from '@/lib/userStore';
import { MarketingRequestRecord, MarketingRequestStatus } from '@/lib/types';

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

type Action =
  | 'start'
  | 'claim'
  | 'work_on_changes'
  | 'marketing_final_review'
  | 'wait_for_info'
  | 'resume'
  | 'ready_for_review'
  | 'reopen'
  | 'complete';

const TRANSITIONS: Record<Action, { from: MarketingRequestStatus[]; to: MarketingRequestStatus; label: string; requiresRemark?: boolean }> = {
  start: {
    from: ['submitted', 'timeline_set'],
    to: 'marketing_in_progress',
    label: 'Marketing member started working on request'
  },
  claim: {
    from: ['submitted', 'timeline_set'],
    to: 'marketing_in_progress',
    label: 'Marketing member took ownership of request'
  },
  work_on_changes: {
    from: ['tech_changes_requested'],
    to: 'marketing_in_progress',
    label: 'Marketing member working on technical feedback'
  },
  marketing_final_review: {
    from: ['technical_approved', 'tech_changes_requested', 'marketing_in_progress'],
    to: 'marketing_final_review',
    label: 'Marketing preparing final submission for requester'
  },
  wait_for_info: {
    from: ['in_progress', 'marketing_in_progress'],
    to: 'waiting_info',
    label: 'Marketing request waiting for information',
    requiresRemark: true
  },
  resume: {
    from: ['waiting_info'],
    to: 'marketing_in_progress',
    label: 'Marketing request resumed'
  },
  ready_for_review: {
    from: ['in_progress', 'marketing_in_progress'],
    to: 'ready_for_review',
    label: 'Marketing request ready for review'
  },
  reopen: {
    from: ['ready_for_review'],
    to: 'marketing_in_progress',
    label: 'Marketing request reopened for rework'
  },
  complete: {
    from: ['marketing_final_review', 'technical_approved', 'marketing_in_progress', 'tech_changes_requested', 'in_progress', 'ready_for_review'],
    to: 'completed',
    label: 'Marketing request marked completed'
  }
};

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const action = body?.action as Action | undefined;
  const transition = action ? TRANSITIONS[action] : undefined;
  if (!transition) {
    return NextResponse.json({ error: `A valid action (${Object.keys(TRANSITIONS).join(', ')}) is required` }, { status: 400 });
  }

  const remarks = typeof body?.remarks === 'string' ? body.remarks.trim() : '';
  if (transition.requiresRemark && !remarks) {
    return NextResponse.json({ error: 'A remark is required for this action' }, { status: 400 });
  }

  try {
    const records = await marketingRequestStore.list(viewer.username, true);
    const existing = records.find((r) => r.id === id);
    if (!existing) return NextResponse.json({ error: 'Marketing request not found' }, { status: 404 });

    const isAssigned = existing.assigned_to === viewer.username;
    const isPrivilegedOrReviewer = viewer.isPrivileged || (await isModuleActionAllowed(viewer, 'marketing-requests', 'approve'));
    if (!isPrivilegedOrReviewer && !isAssigned) {
      return NextResponse.json({ error: 'Forbidden — only a marketing reviewer or the assigned member can update this request’s status' }, { status: 403 });
    }

    // The assigned member can't act until they've confirmed availability —
    // see assign/route.ts (sets assignment_status) and
    // accept-assignment/decline-assignment. Never blocks a manager/reviewer,
    // and never blocks claim/start on an unassigned ticket (assignment_status
    // is only ever 'pending' after a manager assignment).
    if (isAssigned && !isPrivilegedOrReviewer && existing.assignment_status === 'pending') {
      return NextResponse.json({ error: 'You must accept this assignment before you can act on it' }, { status: 403 });
    }

    if (!transition.from.includes(existing.status)) {
      return NextResponse.json({ error: `This request's current status (${existing.status}) doesn't allow action: ${action}` }, { status: 400 });
    }

    const patch: Partial<MarketingRequestRecord> = {
      status: transition.to,
      updated_at: new Date().toISOString()
    };

    if (action === 'claim' || (action === 'start' && !existing.assigned_to)) {
      patch.assigned_to = viewer.username;
    }

    if (action === 'complete') {
      patch.completion_notes = typeof body?.completionNotes === 'string' ? body.completionNotes.trim() : existing.completion_notes;
      patch.final_submission_notes = patch.completion_notes;
      if (Array.isArray(body?.deliveredFiles)) {
        patch.delivered_files = toStringArray(body.deliveredFiles);
        patch.final_submission_files = patch.delivered_files;
      }
    }

    const updated = await marketingRequestStore.update(id, patch);

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'marketing_request',
      entityId: id,
      action: transition.label,
      previousStatus: existing.status,
      newStatus: transition.to,
      remarks,
      ip: getClientIp(request)
    });

    if (action === 'complete' || action === 'wait_for_info') {
      const notifyTargets = [existing.created_by].filter((u) => u && u !== viewer.username);
      if (notifyTargets.length) {
        await notifyUsers(notifyTargets, {
          title: action === 'complete' ? 'Marketing request completed' : 'Marketing request needs your input',
          body:
            action === 'complete'
              ? `Your request "${existing.title}" is ready and delivered.`
              : `Marketing is waiting for more information on "${existing.title}": ${remarks}`,
          type: action === 'complete' ? 'marketing_request_completed' : 'marketing_request_info_needed',
          entityType: 'marketing_request',
          entityId: id
        });
        const requester = await findUserByUsername(existing.created_by);
        if (requester?.email) {
          void sendMarketingRequestLifecycleEmail({
            name: requester.name,
            email: requester.email,
            event: action === 'complete' ? 'completed' : 'info_needed',
            title: existing.title,
            detail: action === 'wait_for_info' ? remarks : undefined
          });
        }
      }
    }

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
