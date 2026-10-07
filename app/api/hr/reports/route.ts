import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { requireHrModule } from '@/lib/hrAccess';
import { apiErrorResponse } from '@/lib/apiError';
import { getHrExpenseReport } from '@/lib/hrExpenseReportStore';
import { parseHrExpenseReportQuery } from '@/lib/hrExpenseReportQuery';

// HR Expense Report — total Reimbursement / Admin Expense / Office
// Operation spend over a period, grouped by employee, department, or
// expense type. Query parsing is shared with the .../export route so the
// spreadsheet can never disagree with what's on screen.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireHrModule(viewer, 'hr-reports'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const parsed = parseHrExpenseReportQuery(request.nextUrl.searchParams);
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    return NextResponse.json(await getHrExpenseReport(parsed.params));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
