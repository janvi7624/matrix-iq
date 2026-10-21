import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { demoScheduleStore } from '@/lib/demoScheduleStore';
import { appendProjectTimeline } from '@/lib/projectStore';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { DemoOutcome, DemoScheduleRecord } from '@/lib/types';
import { findUserById, findUserByUsername } from '@/lib/userStore';
import { sendDemoLifecycleEmail } from '@/lib/email/notifications';

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

    // Assigning the technical person.
    //
    // Only the SALES PERSON this demo belongs to (its created_by — for a
    // partner-requested demo that is the partner's relationship manager, who
    // owns the deal) or a privileged viewer. Deliberately NOT the pipeline
    // operators allowed through above: an engineer or back-office user may
    // move a demo along, but choosing who performs it is the sales person's
    // call, and an engineer assigning themselves would bypass that entirely.
    //
    // A partner can never reach this route at all — proxy.ts confines them
    // to /api/partner/** — so their request carries no technical person and
    // there is nothing for them to override here.
    if (body.assignedTechnicalPersonId !== undefined || body.technicalMembers !== undefined) {
      const isSalesOwner = existing.created_by === viewer.username;
      if (!viewer.isPrivileged && !isSalesOwner) {
        return NextResponse.json(
          { error: 'Only the sales person this demo belongs to can assign the technical person.' },
          { status: 403 }
        );
      }
      // Reassignment stays open until the demo has actually happened —
      // swapping an engineer mid-preparation is routine, rewriting history
      // after the fact is not.
      if (existing.status === 'demo_completed' || existing.status === 'material_returned' || existing.status === 'dc_closed') {
        return NextResponse.json({ error: 'This demo is already complete.' }, { status: 409 });
      }

      if (typeof body.assignedTechnicalPersonId === 'string') {
        const id = body.assignedTechnicalPersonId.trim();
        if (id) {
          const person = await findUserById(id);
          if (!person) return NextResponse.json({ error: 'That technical person could not be found.' }, { status: 400 });
          patch.assigned_technical_person_id = person.id;
          // The display name is snapshotted alongside the id for the same
          // reason POST does it: older consumers (PDFs) read the text field.
          patch.assigned_technical_person = person.name || person.username;
        } else {
          patch.assigned_technical_person_id = '';
          patch.assigned_technical_person = '';
        }
      }
      if (Array.isArray(body.technicalMembers)) {
        patch.technical_members = toStringArray(body.technicalMembers);
      }
    }

    // Simple status nudges that don't need a structured approval payload —
    // technical-approval and manager-approval have their own sub-routes.
    if (body.status === 'pending_technical' && existing.status === 'draft') {
      patch.status = 'pending_technical';
    } else if (body.status === 'cancelled' && existing.status !== 'dc_closed') {
      patch.status = 'cancelled';
    } else if (body.status === 'demo_completed' && (existing.status === 'material_dispatched' || existing.status === 'ready_for_demo')) {
      // 'material_dispatched' is the onsite path (equipment is with the
      // client); 'ready_for_demo' is the virtual one, where there is no
      // dispatch to wait for — without this a virtual demo could never be
      // marked done at all.
      patch.status = 'demo_completed';
    } else if (typeof body.status === 'string' && body.status) {
      // A status value was supplied but doesn't match any transition legal
      // from the current one (e.g. draft -> dc_closed) — reject it rather
      // than silently ignoring it, so a client bug or bad request is visible
      // instead of returning 200 with the record unchanged.
      return NextResponse.json({ error: `Cannot change status from "${existing.status}" to "${body.status}"` }, { status: 400 });
    }

    // Switchable only while the request is still a draft: once it has been
    // approved, the mode is what decided whether Back Office was involved and
    // whether a challan exists, so flipping it afterwards would strand a demo
    // mid-pipeline.
    if (body.mode === 'virtual' || body.mode === 'onsite') {
      if (existing.status !== 'draft' && body.mode !== existing.mode) {
        return NextResponse.json({ error: 'The demo mode can only be changed while the request is still a draft.' }, { status: 400 });
      }
      patch.mode = body.mode;
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
      if ((patch.status === 'cancelled' || patch.status === 'demo_completed') && existing.created_by && existing.created_by !== viewer.username) {
        const creator = await findUserByUsername(existing.created_by);
        if (creator?.email) {
          void sendDemoLifecycleEmail({
            name: creator.name,
            email: creator.email,
            event: patch.status === 'cancelled' ? 'cancelled' : 'completed',
            clientName: existing.client_name,
            company: existing.company,
            scheduledAt: existing.scheduled_at
          });
        }
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
