import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { poStore } from '@/lib/poStore';
import { appendProjectTimeline, findProjectById, projectStore } from '@/lib/projectStore';
import { findPendingTechnicalRequests } from '@/lib/projectTechnicalRequest';
import { wonBriefFailure } from '@/lib/salesStageRules';
import { apiErrorResponse } from '@/lib/apiError';
import { PoRecord } from '@/lib/types';
import { findUserById } from '@/lib/userStore';
import { sendProcurementLifecycleEmail } from '@/lib/email/notifications';

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const records = await poStore.list(viewer.username, viewer.isPrivileged);
    return NextResponse.json(records);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const projectId = typeof body.projectId === 'string' ? body.projectId.trim() : '';
  const poNumber = typeof body.poNumber === 'string' ? body.poNumber.trim() : '';
  if (!projectId || !poNumber) {
    return NextResponse.json({ error: 'Project and PO number are required' }, { status: 400 });
  }

  const project = await findProjectById(projectId);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  if (!viewer.isPrivileged && project.created_by !== viewer.username) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const record: PoRecord = {
    id: `${Date.now()}`,
    created_at: new Date().toISOString(),
    created_by: viewer.username,
    project_id: projectId,
    po_number: poNumber,
    po_date: typeof body.poDate === 'string' ? body.poDate : '',
    amount: Number(body.amount) || 0,
    attachment_url: typeof body.attachmentUrl === 'string' ? body.attachmentUrl : '',
    advance_received: Number(body.advanceReceived) || 0,
    payment_terms: typeof body.paymentTerms === 'string' ? body.paymentTerms.trim() : '',
    remarks: typeof body.remarks === 'string' ? body.remarks.trim() : ''
  };

  try {
    const created = await poStore.create(record);
    await appendProjectTimeline(
      projectId,
      { by: viewer.username, stage: 'po_received', label: `PO received: ${poNumber}`, remarks: `Amount ${record.amount}` },
      'po_received'
    );

    // PO Received is the final Project Progress stage (Installation/Completed
    // were retired, 2026-09), so receiving the PO *is* winning the deal —
    // close it as won here rather than waiting for a separate manual "Close
    // Project → Won". That status flip is what makes the quotation qualify in
    // lib/salesAchievement.ts, so the owner's sales target picks the amount up
    // on its next read with no stored figure to keep in sync.
    //
    // Mirrors the technical-owner rule from the PATCH /api/projects/[id]
    // "closingAsWon" branch (assigned OR awaiting approval) — a won project
    // with nobody technical on it is how TMS filled up with ownerless
    // projects. Unlike there, a missing owner does NOT fail the request: the
    // PO is a record of something that already happened and must still be
    // saved, so the project simply stays active and the caller is told why.
    let projectClosedAsWon = false;
    let wonBlockedReason = '';
    if (project.status === 'won') {
      projectClosedAsWon = true;
    } else if (project.status === 'lost') {
      wonBlockedReason = 'This project is closed as lost — reopen it before the PO can close it as won.';
    } else if (project.assigned_technical_person_id || (await findPendingTechnicalRequests(projectId)).length > 0) {
      // A deal cannot close as won without a Project Brief, on this path as
      // much as any other.
      //
      // It could before. This route flips the status itself via
      // projectStore.update, so the gate enforced in PATCH
      // /api/projects/[id] was skipped entirely — and because receiving the
      // PO is how deals actually get closed, nobody was ever shown the Won
      // checklist that asks for the brief. Measured 2026-10-28: 14 of 16 won
      // projects had no brief, which is the one thing the technical team
      // inheriting the project actually needs.
      //
      // The BRIEF only, not the full STATUS_GATES.won checklist — see
      // wonBriefFailure. Demanding the rest here (a quotation row above all)
      // would have blocked 15 of 16 wins, because quotes routinely go out by
      // email and never become a row.
      //
      // Same rule as the missing-technical-owner case below: the PO records
      // something that already happened and must still be saved, so a
      // blocked deal stays active and the caller is told why, rather than
      // the request failing and the PO being lost.
      if (wonBriefFailure('po_received', project as unknown as Record<string, unknown>)) {
        wonBlockedReason =
          'PO saved, but this project cannot close as won without a Project Brief — add it in the Overview tab. The sales target will not count the deal until then.';
      } else {
        await projectStore.update(projectId, { status: 'won' });
        await appendProjectTimeline(projectId, { by: viewer.username, stage: 'po_received', label: 'Closed as won — PO received' });
        projectClosedAsWon = true;
      }
    } else {
      wonBlockedReason = 'PO saved, but the project needs a technical owner before it can close as won — the sales target will not count it until then.';
    }

    if (project.assigned_technical_person_id) {
      const technicalLead = await findUserById(project.assigned_technical_person_id);
      if (technicalLead?.email && technicalLead.username !== viewer.username) {
        void sendProcurementLifecycleEmail({
          name: technicalLead.name,
          email: technicalLead.email,
          urlPath: `/projects/${projectId}`,
          event: 'po_created',
          itemLabel: poNumber,
          projectName: project.client_name || project.company || 'Project'
        });
      }
    }

    return NextResponse.json({ ...created, projectClosedAsWon, wonBlockedReason }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
