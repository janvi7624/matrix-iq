import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { marketingRequestStore } from '@/lib/marketingRequestStore';
import { isMarketingManager } from '@/lib/permissions';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { notifyUsers } from '@/lib/notificationStore';
import { MarketingRequestRecord, MarketingRequestStatus } from '@/lib/types';

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

type Action = 'start' | 'wait_for_info' | 'resume' | 'ready_for_review' | 'reopen' | 'complete';

// Every legal transition once a timeline is committed. `timeline` itself is
// never touched here — only set-timeline/route.ts can ever write it.
const TRANSITIONS: Record<Action, { from: MarketingRequestStatus[]; to: MarketingRequestStatus; label: string; requiresRemark?: boolean }> = {
  start: { from: ['timeline_set'], to: 'in_progress', label: 'Marketing request marked in progress' },
  wait_for_info: { from: ['in_progress'], to: 'waiting_info', label: 'Marketing request waiting for information', requiresRemark: true },
  resume: { from: ['waiting_info'], to: 'in_progress', label: 'Marketing request resumed' },
  ready_for_review: { from: ['in_progress'], to: 'ready_for_review', label: 'Marketing request ready for review' },
  reopen: { from: ['ready_for_review'], to: 'in_progress', label: 'Marketing request reopened for rework' },
  complete: { from: ['in_progress', 'ready_for_review'], to: 'completed', label: 'Marketing request marked completed' }
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

    // The Marketing Manager can progress anyone's ticket; the assignee can
    // progress their own — a Marketing User works their assigned request
    // without needing manager-level permissions for that alone.
    const isAssignee = !!existing.assigned_to && existing.assigned_to === viewer.username;
    const allowed = isAssignee || (await isMarketingManager(viewer));
    if (!allowed) return NextResponse.json({ error: 'Forbidden — only the Marketing manager or the assignee can update this request’s status' }, { status: 403 });

    if (!transition.from.includes(existing.status)) {
      return NextResponse.json({ error: `This request's current status doesn't allow that action` }, { status: 400 });
    }

    const patch: Partial<MarketingRequestRecord> = { status: transition.to, updated_at: new Date().toISOString() };
    if (action === 'complete') {
      patch.completion_notes = typeof body?.completionNotes === 'string' ? body.completionNotes.trim() : '';
      patch.delivered_files = toStringArray(body?.deliveredFiles);
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
          body: action === 'complete' ? `"${existing.title}" has been completed.` : `"${existing.title}" is waiting on information from you: ${remarks}`,
          type: action === 'complete' ? 'marketing_request_completed' : 'marketing_request_waiting_info',
          entityType: 'marketing_request',
          entityId: id
        });
      }
    }

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
