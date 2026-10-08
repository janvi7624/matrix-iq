import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { canManageTargets } from '@/lib/targetAccess';
import { resolveVisibilityScope } from '@/lib/departmentScope';
import { deleteSalesTarget, findMonthAmounts, findSalesTargetById, updateSalesTarget, upsertSalesTargets } from '@/lib/salesTargetStore';
import { buildTargetsFromMonths, DERIVED_PERIOD_TYPES, rollupSummary } from '@/lib/targetRollup';
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

    if (body.targetAmount !== undefined) {
      // A quarter, half or year is the SUM of its months (lib/targetRollup.ts),
      // so there is no single right way to honour "set Q2 to 9L" — it could
      // mean 3L a month, or all of it in one month. Rather than guess and
      // overwrite months the user set deliberately, this says so and points
      // at the months, which are the only figures anybody edits.
      if (DERIVED_PERIOD_TYPES.includes(existing.periodType)) {
        return NextResponse.json(
          { error: `${existing.displayPeriod} is the total of its months and can't be set directly — edit the monthly targets and this updates with them.` },
          { status: 400 }
        );
      }

      const amount = Number(body.targetAmount);
      if (!Number.isFinite(amount) || amount < 0) return NextResponse.json({ error: 'Target amount must be zero or more' }, { status: 400 });

      // Only THIS month changes; the other eleven keep whatever they were set
      // to. Then the whole year is rebuilt from them, so the quarter, half and
      // year totals move by exactly this month's delta instead of going stale.
      const months = await findMonthAmounts(existing.employeeId, existing.fiscalYear);
      months[existing.periodStart.slice(0, 7)] = amount;

      const rows = buildTargetsFromMonths(existing.fiscalYear, months);
      const { created, updated: updatedCount } = await upsertSalesTargets(existing.employeeId, rows, viewer.userId, notes);
      const refreshed = await findSalesTargetById(id);
      return NextResponse.json({
        target: refreshed,
        rollup: { created, updated: updatedCount, periods: rows.length, ...rollupSummary(existing.fiscalYear, months) }
      });
    }

    // Notes-only edit — no figure moved, so nothing to roll up.
    const updated = await updateSalesTarget(id, { notes, updatedBy: viewer.userId });
    return NextResponse.json({ target: updated, rollup: null });
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
