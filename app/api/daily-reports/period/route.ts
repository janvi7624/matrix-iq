import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { getPeriodSummary } from '@/lib/dailyReportPeriodStore';
import { apiErrorResponse } from '@/lib/apiError';

// Daily Report compliance over a range, for the month/quarter/year/custom
// filters and the department PDF.
//
// Takes a plain from/to rather than a granularity, which is what
// lib/hrReportPeriod.ts's own comment argues for: the API keeps ONE date-range
// contract and the picker decides what a "period" means. It also keeps the HR
// expense report's data-bounds clamping out of here, where it would be wrong —
// daily reports and expenses start in different months.
//
// No role gate: what a viewer sees is resolveDailyReportScope inside
// getPeriodSummary — their own department, the ones they manage, or org-wide.
// A department id in the query can narrow that but never widen it.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// A year at a time. Without a cap a single request can expand to every
// employee times every working day since the module existed, and the fold is
// in memory.
const MAX_RANGE_DAYS = 366;

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const from = params.get('from') || '';
  const to = params.get('to') || '';

  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) {
    return NextResponse.json({ error: 'from and to are required, as YYYY-MM-DD.' }, { status: 400 });
  }
  if (from > to) {
    return NextResponse.json({ error: 'from must not be after to.' }, { status: 400 });
  }
  const spanDays = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  if (spanDays > MAX_RANGE_DAYS) {
    return NextResponse.json({ error: 'Pick a range of a year or less.' }, { status: 400 });
  }

  try {
    const report = await getPeriodSummary(viewer, {
      from,
      to,
      departmentId: params.get('departmentId') || undefined,
      search: params.get('search') || undefined
    });
    return NextResponse.json(report);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
