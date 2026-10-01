import { NextRequest, NextResponse } from 'next/server';
import { getTmsViewer, requireTmsAction } from '@/lib/tmsAccess';
import { findPhaseById, removePhase, updatePhase } from '@/lib/tmsProjectPhaseStore';
import { TmsProjectPhaseStatus } from '@/lib/types';
import { apiErrorResponse } from '@/lib/apiError';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';

const VALID_STATUS: TmsProjectPhaseStatus[] = ['pending', 'in_progress', 'completed'];

// Addressed by phase id rather than nested under the project, so editing one
// doesn't need the project id in the URL as well — the phase already knows
// which project it belongs to.

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getTmsViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireTmsAction(viewer, 'tms-projects', 'edit'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  try {
    const existing = await findPhaseById(id);
    if (!existing) return NextResponse.json({ error: 'Phase not found' }, { status: 404 });

    if (body.status !== undefined && !VALID_STATUS.includes(body.status)) {
      return NextResponse.json({ error: 'Invalid phase status' }, { status: 400 });
    }

    const updated = await updatePhase(id, {
      name: typeof body.name === 'string' ? body.name : undefined,
      description: typeof body.description === 'string' ? body.description : undefined,
      // Passed through as given, including '' — that is how a deadline set by
      // mistake gets cleared rather than only changed.
      expectedEndDate: typeof body.expectedEndDate === 'string' ? body.expectedEndDate : undefined,
      sequence: typeof body.sequence === 'number' ? body.sequence : undefined,
      status: body.status
    });
    if (!updated) return NextResponse.json({ error: 'Could not update this phase' }, { status: 400 });

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'tms_project',
      entityId: existing.tms_project_id,
      action: `Phase updated: ${updated.name}`,
      previousStatus: existing.status,
      newStatus: updated.status,
      ip: getClientIp(request)
    });

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getTmsViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // Deleting part of the delivery plan is a bigger act than editing one, so
  // it needs the module's 'delete' right rather than 'edit'.
  if (!(await requireTmsAction(viewer, 'tms-projects', 'delete'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  try {
    const existing = await findPhaseById(id);
    if (!existing) return NextResponse.json({ error: 'Phase not found' }, { status: 404 });

    const removed = await removePhase(id);
    if (!removed) return NextResponse.json({ error: 'Could not delete this phase' }, { status: 400 });

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'tms_project',
      entityId: existing.tms_project_id,
      action: `Phase deleted: ${existing.name}`,
      previousStatus: existing.status,
      newStatus: '',
      ip: getClientIp(request)
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
