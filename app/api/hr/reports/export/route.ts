import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { requireHrModule } from '@/lib/hrAccess';
import { apiErrorResponse } from '@/lib/apiError';
import { getHrExpenseReport } from '@/lib/hrExpenseReportStore';
import { parseHrExpenseReportQuery } from '@/lib/hrExpenseReportQuery';
import { buildHrExpenseReportXlsx, hrExpenseReportFileName } from '@/lib/hrExpenseReportXlsx';
import { findUserById } from '@/lib/userStore';

// Same query string, same aggregation as the JSON report — the spreadsheet
// is built server-side so the export can never drift from what the screen
// shows (and so a 10k-row matrix isn't assembled in the browser).
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireHrModule(viewer, 'hr-reports'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const parsed = parseHrExpenseReportQuery(request.nextUrl.searchParams);
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const report = await getHrExpenseReport(parsed.params);
    const employee = parsed.params.employeeId ? await findUserById(parsed.params.employeeId) : undefined;
    const buffer = await buildHrExpenseReportXlsx(report, {
      department: parsed.params.department,
      employeeName: employee ? employee.name || employee.username : undefined
    });

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${hrExpenseReportFileName(report)}"`
      }
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
