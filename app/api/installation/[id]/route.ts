import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { installationStore } from '@/lib/installationStore';
import { appendProjectTimeline, findProjectById } from '@/lib/projectStore';
import { apiErrorResponse } from '@/lib/apiError';
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

    if (patch.status === 'completed' && existing.status !== 'completed') {
      await appendProjectTimeline(
        existing.project_id,
        { by: viewer.username, stage: 'completed', label: 'Installation completed — project closed as won', remarks: patch.completion_report || '' },
        'completed'
      );

      const project = existing.project_id ? await findProjectById(existing.project_id) : undefined;
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
    const deleted = await installationStore.remove(id, viewer.username, viewer.isPrivileged);
    if (!deleted) return NextResponse.json({ error: 'Installation not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
