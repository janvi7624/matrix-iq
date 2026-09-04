import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { canManageTargets } from '@/lib/targetAccess';
import { resolveVisibilityScope } from '@/lib/departmentScope';
import { deleteSalesTarget, findSalesTargetById, updateSalesTarget } from '@/lib/salesTargetStore';
import { apiErrorResponse } from '@/lib/apiError';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canManageTargets(viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  try {
    const existing = await findSalesTargetById(id);
    if (!existing) return NextResponse.json({ error: 'Target not found' }, { status: 404 });

    const scope = await resolveVisibilityScope(viewer.username);
    if (!scope.seesOrgWide && !(scope.scopedUserIds ?? []).includes(existing.employeeId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const patch: { targetAmount?: number; notes?: string; updatedBy: string } = { updatedBy: viewer.userId };
    if (body.targetAmount !== undefined) {
      const amount = Number(body.targetAmount);
      if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: 'Target amount must be greater than zero' }, { status: 400 });
      patch.targetAmount = amount;
    }
    if (typeof body.notes === 'string') patch.notes = body.notes;

    const updated = await updateSalesTarget(id, patch);
    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canManageTargets(viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  try {
    const existing = await findSalesTargetById(id);
    if (!existing) return NextResponse.json({ error: 'Target not found' }, { status: 404 });

    const scope = await resolveVisibilityScope(viewer.username);
    if (!scope.seesOrgWide && !(scope.scopedUserIds ?? []).includes(existing.employeeId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const removed = await deleteSalesTarget(id);
    if (!removed) return NextResponse.json({ error: 'Target not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
