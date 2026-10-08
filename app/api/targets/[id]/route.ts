import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { canManageTargets } from '@/lib/targetAccess';
import { resolveVisibilityScope } from '@/lib/departmentScope';
import { deleteSalesTarget, findSalesTargetById, updateSalesTarget, upsertSalesTargets } from '@/lib/salesTargetStore';
import { buildCascadedTargets, cascadeSummary } from '@/lib/targetCascade';
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

    const notes = typeof body.notes === 'string' ? body.notes : undefined;

    // Editing the AMOUNT re-prices the whole fiscal year, exactly as setting
    // it the first time does — the four period types are one number at four
    // scales, so changing the monthly figure without moving the quarters and
    // the year would put them straight back out of step
    // (lib/targetCascade.ts).
    if (body.targetAmount !== undefined) {
      const amount = Number(body.targetAmount);
      if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: 'Target amount must be greater than zero' }, { status: 400 });

      const rows = buildCascadedTargets(existing.fiscalYear, existing.periodType, amount);
      const { created, updated: updatedCount } = await upsertSalesTargets(existing.employeeId, rows, viewer.userId, notes);
      const refreshed = await findSalesTargetById(id);
      return NextResponse.json({
        target: refreshed,
        cascade: { created, updated: updatedCount, periods: rows.length, amounts: cascadeSummary(existing.periodType, amount) }
      });
    }

    // Notes-only edit — nothing to re-price, so nothing cascades.
    const updated = await updateSalesTarget(id, { notes, updatedBy: viewer.userId });
    return NextResponse.json({ target: updated, cascade: null });
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
