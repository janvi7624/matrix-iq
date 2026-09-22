import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { canAccessProject, findProjectById } from '@/lib/projectStore';
import { requestTechnicalPerson, withdrawTechnicalRequest, TechnicalRequestError } from '@/lib/projectTechnicalRequest';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';

// POST — pick a technical person for this Sales project. Becomes an approval
// request for the engineer / their department manager, unless the viewer is
// one of the people who could approve it (then it's assigned straight away).
// Response: { mode: 'requested', request } | { mode: 'assigned', project }.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const personId = typeof body?.personId === 'string' ? body.personId.trim() : '';
  if (!personId) return NextResponse.json({ error: 'Pick a technical person' }, { status: 400 });

  try {
    const project = await findProjectById(id);
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    if (!(await canAccessProject(viewer.username, project))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const result = await requestTechnicalPerson(
      project,
      personId,
      viewer,
      { note: typeof body.note === 'string' ? body.note.trim() : '', neededBy: typeof body.neededBy === 'string' ? body.neededBy.trim() : '' },
      getClientIp(request)
    );
    return NextResponse.json(result, { status: result.mode === 'requested' ? 201 : 200 });
  } catch (error) {
    if (error instanceof TechnicalRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
    return apiErrorResponse(error);
  }
}

// DELETE — withdraw the request still waiting for approval.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    const project = await findProjectById(id);
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    if (!(await canAccessProject(viewer.username, project))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    await withdrawTechnicalRequest(id, viewer, getClientIp(request));
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof TechnicalRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
    return apiErrorResponse(error);
  }
}
