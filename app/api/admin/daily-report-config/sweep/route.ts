import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { dailyReportErrorResponse } from '@/lib/dailyReportApi';
import { canAccessDailyReportConfig } from '@/lib/dailyReportAccess';
import { previewDailyReportSweep, runDailyReportSweep } from '@/lib/dailyReportScheduler';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';

// The admin page's two scheduler controls.
//
// GET  — a read-only PREVIEW of what is due right now. Claims nothing, sends
//        nothing, writes nothing; safe to refresh as often as you like.
//        This is what an administrator uses to see the module's state
//        before arming it.
// POST — runs a sweep on demand. Obeys the stored dry-run flag, and
//        `dryRun: true` in the body can force a rehearsal even when the
//        stored config says live. There is deliberately no way to force a
//        LIVE send past a config that says dry-run: the escape hatch only
//        ever points towards the safer behaviour.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canAccessDailyReportConfig(viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const preview = await previewDailyReportSweep();
    return NextResponse.json({
      ...preview,
      // Trimmed for the UI: the full list can be thousands of events on a
      // first run over a week-long window, and the page only shows a sample
      // alongside the per-kind counts.
      dueNow: preview.dueNow.slice(0, 100).map((event) => ({
        kind: event.kind,
        employeeId: event.employeeId,
        reportDate: event.reportDate,
        dueAt: event.dueAt.toISOString(),
        late: event.late
      })),
      dueNowTotal: preview.dueNow.length
    });
  } catch (error) {
    return dailyReportErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canAccessDailyReportConfig(viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => null);
  const forceDryRun = (body as { dryRun?: unknown })?.dryRun === true;

  try {
    const result = await runDailyReportSweep({ trigger: 'manual', forceDryRun });
    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'daily_report_config',
      entityId: result.runId,
      action: `Ran the daily report sweep manually${result.stats.dryRun ? ' (dry run)' : ''}`,
      previousStatus: '',
      newStatus: result.status,
      remarks: [
        `${result.stats.subjects} subjects`,
        `sent ${JSON.stringify(result.stats.sent)}`,
        `${result.stats.warningsRecorded} warnings`,
        `${result.stats.escalationsSent} escalations`,
        result.reason ?? ''
      ]
        .filter(Boolean)
        .join(' · ')
        .slice(0, 240),
      ip: getClientIp(request)
    });
    return NextResponse.json(result);
  } catch (error) {
    return dailyReportErrorResponse(error);
  }
}
