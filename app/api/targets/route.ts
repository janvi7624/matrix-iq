import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { canManageTargets, listSalesTeamRoster } from '@/lib/targetAccess';
import { resolveVisibilityScope } from '@/lib/departmentScope';
import { buildPeriod, currentFiscalYear, listPeriodOptions, PeriodRange, periodContainingDate, TargetPeriodType } from '@/lib/targetPeriod';
import { buildTargetsFromMonths, fiscalYearMonthKeys, MonthAmounts, rollupSummary } from '@/lib/targetRollup';
import { findSalesTarget, listSalesTargets, upsertSalesTargets } from '@/lib/salesTargetStore';
import { computeAchievementForEmployees, computeStatus } from '@/lib/salesAchievement';
import { apiErrorResponse } from '@/lib/apiError';

const VALID_PERIOD_TYPES: TargetPeriodType[] = ['monthly', 'quarterly', 'half_yearly', 'annual'];

function resolvePeriod(url: URL) {
  const periodTypeParam = url.searchParams.get('periodType');
  const periodType: TargetPeriodType = VALID_PERIOD_TYPES.includes(periodTypeParam as TargetPeriodType) ? (periodTypeParam as TargetPeriodType) : 'monthly';
  const fiscalYear = url.searchParams.get('fiscalYear') || currentFiscalYear();
  const periodKey = url.searchParams.get('periodKey') ?? undefined;
  if (periodKey !== undefined) return buildPeriod(periodType, fiscalYear, periodKey || undefined);
  return periodContainingDate(periodType);
}

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canManageTargets(viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const period = resolvePeriod(new URL(request.url));
    const roster = await listSalesTeamRoster(viewer.username);
    const employeeIds = roster.map((r) => r.id);

    const [targets, achievements] = await Promise.all([
      listSalesTargets({ periodType: period.periodType, periodStart: period.periodStart, employeeIds }),
      computeAchievementForEmployees(employeeIds, period.periodStart, period.periodEnd)
    ]);
    const targetByEmployeeId = new Map(targets.map((t) => [t.employeeId, t]));

    let totalTarget = 0;
    let totalAchieved = 0;
    let exceededCount = 0;
    let achievedCount = 0;
    let onTrackCount = 0;
    let atRiskCount = 0;
    let notStartedCount = 0;

    const employees = roster.map((member) => {
      const target = targetByEmployeeId.get(member.id);
      const achievedAmount = achievements[member.id]?.achievedAmount ?? 0;
      const targetAmount = target?.targetAmount ?? 0;
      const status = computeStatus(targetAmount, achievedAmount, period.periodStart, period.periodEnd);
      const achievementPercent = targetAmount > 0 ? Math.round((achievedAmount / targetAmount) * 100) : 0;

      totalTarget += targetAmount;
      totalAchieved += achievedAmount;
      if (status === 'exceeded') exceededCount++;
      else if (status === 'achieved') achievedCount++;
      else if (status === 'on_track') onTrackCount++;
      else if (status === 'at_risk') atRiskCount++;
      else notStartedCount++;

      return {
        employeeId: member.id,
        username: member.username,
        name: member.name,
        designation: member.designation,
        targetId: target?.id ?? null,
        targetAmount,
        achievedAmount,
        achievementPercent,
        status,
        updatedAt: target?.updatedAt ?? ''
      };
    });

    return NextResponse.json({
      periodType: period.periodType,
      fiscalYear: period.fiscalYear,
      periodKey: period.periodKey,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      displayPeriod: period.displayPeriod,
      summary: {
        totalTarget,
        totalAchieved,
        achievementPercent: totalTarget > 0 ? Math.round((totalAchieved / totalTarget) * 100) : 0,
        employeeCount: roster.length,
        exceededCount,
        achievedCount,
        onTrackCount,
        atRiskCount,
        notStartedCount
      },
      employees
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

// Which of the fiscal year's periods the POST response echoes back. A write
// always covers every period of the FY (lib/targetRollup.ts), so naming a
// specific one is genuinely optional — TargetFormDialog deliberately sends no
// month/quarter/half, since the write doesn't depend on it. Only the echo
// does, and buildPeriod demands a key for every type but 'annual', which is
// why an unnamed period used to 500 the request. Unnamed now means "the
// period of this type containing today", falling back to the FY's first such
// period when today isn't inside the FY being written (setting next year's
// targets). A named-but-invalid key still throws, for the caller to turn
// into a 400.
function resolveEchoPeriod(periodType: TargetPeriodType, fiscalYear: string, periodKey?: string): PeriodRange {
  if (periodKey) return buildPeriod(periodType, fiscalYear, periodKey);
  if (periodType === 'annual') return buildPeriod(periodType, fiscalYear);
  const current = periodContainingDate(periodType);
  if (current.fiscalYear === fiscalYear) return current;
  return buildPeriod(periodType, fiscalYear, listPeriodOptions(periodType, fiscalYear)[0].key);
}

export async function POST(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canManageTargets(viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const employeeId = typeof body.employeeId === 'string' ? body.employeeId : '';
  // Only used to pick which period the response echoes back (the caller's
  // current filter) — it no longer says anything about what is being written,
  // since what's written is always the 12 months.
  const periodType: TargetPeriodType = VALID_PERIOD_TYPES.includes(body.periodType) ? (body.periodType as TargetPeriodType) : 'monthly';
  const fiscalYear = typeof body.fiscalYear === 'string' ? body.fiscalYear : '';
  const periodKey = body.month || body.quarter || body.half || undefined;
  const notes = typeof body.notes === 'string' ? body.notes : '';

  if (!employeeId) return NextResponse.json({ error: 'Employee is required' }, { status: 400 });
  if (!fiscalYear) return NextResponse.json({ error: 'Fiscal year is required' }, { status: 400 });

  // Targets are entered MONTH BY MONTH — each month its own figure — and the
  // quarters, halves and the year are the sums of those months
  // (lib/targetRollup.ts). The old body shape was a single `targetAmount` at
  // one scale, spread evenly over the year, which could not express "April 2L,
  // May 3L"; it is deliberately no longer accepted rather than silently
  // reinterpreted, so a stale caller fails loudly instead of writing twelve
  // identical months.
  if (body.months === undefined || typeof body.months !== 'object' || Array.isArray(body.months)) {
    return NextResponse.json(
      { error: 'Send `months` as a map of month key to amount, e.g. { "2026-04": 200000 }. A single target amount is no longer accepted — each month is set on its own.' },
      { status: 400 }
    );
  }

  const validMonthKeys = new Set(fiscalYearMonthKeys(fiscalYear));
  const months: MonthAmounts = {};
  for (const [key, raw] of Object.entries(body.months as Record<string, unknown>)) {
    if (!validMonthKeys.has(key)) {
      return NextResponse.json({ error: `${key} is not a month of FY ${fiscalYear}` }, { status: 400 });
    }
    // Blank/absent is how "no target this month" is expressed, so an empty
    // string is a zero rather than an error. A negative or non-numeric figure
    // is a genuine mistake.
    if (raw === '' || raw === null || raw === undefined) continue;
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount < 0) {
      return NextResponse.json({ error: `Target for ${key} must be a number of zero or more` }, { status: 400 });
    }
    months[key] = amount;
  }

  if (!Object.values(months).some((amount) => amount > 0)) {
    return NextResponse.json({ error: 'Set a target of more than zero for at least one month' }, { status: 400 });
  }

  // Resolved BEFORE the upsert, not after: buildPeriod throws on a bad key,
  // and doing it afterwards meant the write had already committed — the
  // caller got a 500 for a target that was in fact saved, and the form showed
  // "Could not save this target."
  let echoPeriod: PeriodRange;
  try {
    echoPeriod = resolveEchoPeriod(periodType, fiscalYear, periodKey);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid period' }, { status: 400 });
  }

  try {
    // An employee outside the viewer's own visibility scope can't be given a
    // target — the same rule the roster listing itself already enforces.
    const scope = await resolveVisibilityScope(viewer.username);
    if (!scope.seesOrgWide && !(scope.scopedUserIds ?? []).includes(employeeId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Still all 19 periods in one transaction: the 12 months as entered, plus
    // the 4 quarters, 2 halves and the year derived from them. Writing the
    // months without their rollups would leave the quarter view showing a
    // stale sum, which is exactly the inconsistency this upsert exists to
    // prevent.
    const rows = buildTargetsFromMonths(fiscalYear, months);
    const { created, updated } = await upsertSalesTargets(employeeId, rows, viewer.userId, notes || undefined);

    const saved = await findSalesTarget(employeeId, periodType, echoPeriod.periodStart);

    return NextResponse.json(
      { target: saved, rollup: { created, updated, periods: rows.length, ...rollupSummary(fiscalYear, months) } },
      { status: 201 }
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}
