import { NextRequest, NextResponse } from 'next/server';
import { getTmsViewer, requireTmsAction } from '@/lib/tmsAccess';
import { tmsProjectStore } from '@/lib/tmsProjectStore';
import { createPhase, listPhases } from '@/lib/tmsProjectPhaseStore';
import { apiErrorResponse } from '@/lib/apiError';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';

// Delivery phases of one TMS project, each with its own expected end date.
// Gated on the tms-projects module (not tms-tasks): a phase is part of the
// project's plan, so whoever may edit the project may plan its phases.

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getTmsViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireTmsAction(viewer, 'tms-projects', 'view'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const { id } = await params;
    return NextResponse.json(await listPhases(id));
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getTmsViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireTmsAction(viewer, 'tms-projects', 'edit'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ error: 'Phase name is required' }, { status: 400 });

  try {
    // Checked before creating, so a bad project id fails as 404 rather than
    // leaving an orphan phase the FK would have rejected anyway.
    const project = await tmsProjectStore.findById(id);
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

    const created = await createPhase({
      tmsProjectId: id,
      name,
      description: typeof body.description === 'string' ? body.description : '',
      expectedEndDate: typeof body.expectedEndDate === 'string' ? body.expectedEndDate : '',
      createdByUserId: viewer.userId
    });
    if (!created) return NextResponse.json({ error: 'Could not create this phase' }, { status: 400 });

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'tms_project',
      entityId: id,
      action: `Phase added: ${created.name}${created.expected_end_date ? ` (due ${created.expected_end_date})` : ''}`,
      previousStatus: '',
      newStatus: created.status,
      ip: getClientIp(request)
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
