import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { demoScheduleStore } from '@/lib/demoScheduleStore';
import { appendProjectTimeline } from '@/lib/projectStore';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { DemoOutcome, DemoScheduleRecord } from '@/lib/types';

const VALID_OUTCOMES: (DemoOutcome | '')[] = ['', 'successful', 'need_followup', 'pending_decision', 'cancelled'];

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  try {
    const records = await demoScheduleStore.list(viewer.username, true);
    const existing = records.find((r) => r.id === id);
    if (!existing) return NextResponse.json({ error: 'Demo not found' }, { status: 404 });
    // The creator/admin/manager can edit anything here; engineer/backoffice
    // are legitimate operators later in the pipeline (marking a demo
    // complete, filling in the report) even though they didn't create the
    // request, so they're allowed through too.
    const isPipelineOperator = viewer.role === 'engineer' || viewer.role === 'backoffice';
    if (!viewer.isPrivileged && !isPipelineOperator && existing.created_by !== viewer.username) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const patch: Partial<DemoScheduleRecord> = {};
    const previousStatus = existing.status;

    // Simple status nudges that don't need a structured approval payload —
    // technical-approval and manager-approval have their own sub-routes.
    if (body.status === 'pending_technical' && existing.status === 'draft') {
      patch.status = 'pending_technical';
    } else if (body.status === 'cancelled' && existing.status !== 'dc_closed') {
      patch.status = 'cancelled';
    } else if (body.status === 'demo_completed' && existing.status === 'material_dispatched') {
      patch.status = 'demo_completed';
    } else if (typeof body.status === 'string' && body.status) {
      // A status value was supplied but doesn't match any transition legal
      // from the current one (e.g. draft -> dc_closed) — reject it rather
      // than silently ignoring it, so a client bug or bad request is visible
      // instead of returning 200 with the record unchanged.
      return NextResponse.json({ error: `Cannot change status from "${existing.status}" to "${body.status}"` }, { status: 400 });
    }

    if (typeof body.notes === 'string') patch.notes = body.notes.trim();
    if (typeof body.demoObjective === 'string') patch.demo_objective = body.demoObjective.trim();
    if (VALID_OUTCOMES.includes(body.outcome)) patch.outcome = body.outcome;
    if (body.customerRating !== undefined) {
      const rating = Number(body.customerRating);
      if (Number.isFinite(rating)) patch.customer_rating = Math.min(5, Math.max(0, Math.round(rating)));
    }
    if (typeof body.keyQueries === 'string') patch.key_queries = body.keyQueries.trim();
    if (typeof body.technicalChallenges === 'string') patch.technical_challenges = body.technicalChallenges.trim();
    if (typeof body.unansweredQueries === 'string') patch.unanswered_queries = body.unansweredQueries.trim();
    if (typeof body.suggestedNextAction === 'string') patch.suggested_next_action = body.suggestedNextAction.trim();
    if (typeof body.nextFollowUpDate === 'string') patch.next_follow_up_date = body.nextFollowUpDate;
    if (Array.isArray(body.attachments)) patch.attachments = toStringArray(body.attachments);

    const updated = await demoScheduleStore.update(id, patch);

    if (patch.outcome && existing.project_id) {
      await appendProjectTimeline(existing.project_id, {
        by: viewer.username,
        stage: 'demo',
        label: `Demo outcome logged: ${patch.outcome.replace(/_/g, ' ')}`,
        remarks: patch.suggested_next_action || ''
      });
    }

    if (patch.status && patch.status !== previousStatus) {
      if (existing.project_id) {
        await appendProjectTimeline(existing.project_id, { by: viewer.username, stage: 'demo', label: `Demo status: ${patch.status.replace(/_/g, ' ')}` });
      }
      await logAudit({
        by: viewer.username,
        role: viewer.role,
        entityType: 'demo',
        entityId: id,
        action: `Status changed to ${patch.status.replace(/_/g, ' ')}`,
        previousStatus,
        newStatus: patch.status,
        ip: getClientIp(request)
      });
    }

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    const deleted = await demoScheduleStore.remove(id, viewer.username, viewer.isPrivileged);
    if (!deleted) return NextResponse.json({ error: 'Demo not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
