import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { installationStore } from '@/lib/installationStore';
import { appendProjectTimeline } from '@/lib/projectStore';
import { apiErrorResponse } from '@/lib/apiError';
import { InstallationRecord } from '@/lib/types';

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const records = await installationStore.list(viewer.username, viewer.isPrivileged);
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
  const installationDate = typeof body.installationDate === 'string' ? body.installationDate : '';
  if (!projectId || !installationDate) {
    return NextResponse.json({ error: 'Project and installation date are required' }, { status: 400 });
  }

  const record: InstallationRecord = {
    id: `${Date.now()}`,
    created_at: new Date().toISOString(),
    created_by: viewer.username,
    project_id: projectId,
    installation_date: installationDate,
    assigned_engineer: typeof body.assignedEngineer === 'string' ? body.assignedEngineer.trim() : '',
    status: 'scheduled',
    completion_report: '',
    client_signature: ''
  };

  try {
    const created = await installationStore.create(record);
    await appendProjectTimeline(
      projectId,
      { by: viewer.username, stage: 'installation', label: 'Installation scheduled', remarks: `Engineer: ${record.assigned_engineer || '-'}` },
      'installation'
    );
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
