import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { installationStore } from '@/lib/installationStore';
import { appendProjectTimeline, findProjectById, projectStore } from '@/lib/projectStore';
import { apiErrorResponse } from '@/lib/apiError';
import { wonBriefFailure } from '@/lib/salesStageRules';
import { sendFieldOpsLifecycleEmail } from '@/lib/email/notifications';
import { findUserByUsername } from '@/lib/userStore';
import { InstallationRecord } from '@/lib/types';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const patch: Partial<InstallationRecord> = {};
  if (typeof body.assignedEngineer === 'string') patch.assigned_engineer = body.assignedEngineer.trim();
  if (body.status === 'scheduled' || body.status === 'in_progress' || body.status === 'completed') patch.status = body.status;
  if (typeof body.completionReport === 'string') patch.completion_report = body.completionReport.trim();
  if (typeof body.clientSignature === 'string') patch.client_signature = body.clientSignature.trim();

  try {
    const records = await installationStore.list(viewer.username, true);
    const existing = records.find((r) => r.id === id);
    if (!existing) return NextResponse.json({ error: 'Installation not found' }, { status: 404 });
    if (!viewer.isPrivileged && existing.created_by !== viewer.username) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const updated = await installationStore.update(id, patch);

    let wonBlockedReason = '';
    if (patch.status === 'completed' && existing.status !== 'completed') {
      // Project Progress no longer has an 'installation'/'completed' stage
      // (PO Received is now the final stage) — this only logs the timeline
      // event and closes the deal as won, it no longer moves Project.stage.
      //
      // A Project Brief is required here exactly as it is on the PO path.
      // It was not before: this route called projectStore.update({ status:
      // 'won' }) directly, bypassing the gate PATCH /api/projects/[id]
      // enforces, so a completed installation could close a deal carrying
      // no brief. The brief only, for the same reason as the PO route —
      // see wonBriefFailure.
      //
      // A blocked deal still records the completed installation, because it
      // genuinely happened; it just leaves the deal open and says why,
      // rather than discarding the installation.
      const project = existing.project_id ? await findProjectById(existing.project_id) : undefined;
      if (project && project.status !== 'won' && wonBriefFailure(project.stage, project as unknown as Record<string, unknown>)) {
        wonBlockedReason =
          "Installation saved, but this project cannot close as won without a Project Brief — add it in the project's Overview tab.";
      }

      // The label has to tell the truth about what just happened: claiming
      // "project closed as won" on a blocked gate is how the Activity Log
      // ends up disagreeing with the project's own status.
      await appendProjectTimeline(
        existing.project_id,
        {
          by: viewer.username,
          stage: 'completed',
          label: wonBlockedReason ? 'Installation completed' : 'Installation completed — project closed as won',
          remarks: patch.completion_report || ''
        }
      );
      if (!wonBlockedReason) await projectStore.update(existing.project_id, { status: 'won' });

      if (project?.created_by && project.created_by !== viewer.username) {
        const owner = await findUserByUsername(project.created_by);
        if (owner?.email) {
          void sendFieldOpsLifecycleEmail({
            name: owner.name,
            email: owner.email,
            urlPath: '/installation',
            event: 'installation_completed',
            subjectLabel: project.client_name || project.company || 'Project'
          });
        }
      }
    }

    // Shape is unchanged when nothing is blocked, so existing callers that
    // only check response.ok keep working; the reason is added only when
    // there is one to report.
    return NextResponse.json(wonBlockedReason ? { ...updated, wonBlockedReason } : updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    const deleted = await installationStore.remove(id, viewer.username, viewer.isPrivileged);
    if (!deleted) return NextResponse.json({ error: 'Installation not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
