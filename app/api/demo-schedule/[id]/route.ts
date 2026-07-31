import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { demoScheduleStore } from '@/lib/demoScheduleStore';
import { appendProjectTimeline } from '@/lib/projectStore';
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
    if (!viewer.isPrivileged && existing.created_by !== viewer.username) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const patch: Partial<DemoScheduleRecord> = {};

    if (body.status === 'confirmed' || body.status === 'rejected') {
      // Only an admin/superadmin (standing in for the domain lead) may
      // confirm or reject a pending request.
      if (!viewer.isPrivileged) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      patch.status = body.status;
      patch.approved_by = viewer.username;
      patch.approved_at = new Date().toISOString();
      if (typeof body.decisionNote === 'string') patch.decision_note = body.decisionNote.trim();
    } else if (body.status === 'cancelled' || body.status === 'done') {
      patch.status = body.status;
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
