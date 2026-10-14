import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { dailyReportErrorResponse } from '@/lib/dailyReportApi';
import { canAccessDailyReportConfig, resolveHrRecipients } from '@/lib/dailyReportAccess';
import { getDailyReportConfig, updateDailyReportConfig } from '@/lib/dailyReportConfigStore';
import {
  listAvailableTemplates,
  listTemplateAssignmentsForAdmin,
  updateTemplateAssignment
} from '@/lib/dailyReportTemplateStore';
import { DailyReportConfigResponse } from '@/lib/dailyReportTypes';
import { db } from '@/lib/db';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { isUuidLike } from '@/lib/dailyReportApiIds';

// Daily Report Configuration — department formats, the working-day and
// deadline policy, the warning threshold, and the scheduler's two switches.
//
// Base auth and the isPrivileged gate happen in proxy.ts (ADMIN_ONLY_PREFIXES
// covers /api/admin), and canAccessDailyReportConfig narrows it further to
// Admin/Super Admin — a department manager reaching /admin is not the
// authority to arm a job that emails the whole company. See its own comment.

const RUN_LIMIT = 20;
const EVENT_LIMIT = 50;

function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canAccessDailyReportConfig(viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const [config, templates, runRows, eventRows, hrRecipients, employeeRows] = await Promise.all([
      getDailyReportConfig(),
      listTemplateAssignmentsForAdmin(),
      db.DailyReportSchedulerRun.findAll({ order: [['started_at', 'DESC']], limit: RUN_LIMIT }),
      db.DailyReportNotificationEvent.findAll({
        order: [['processed_at', 'DESC']],
        limit: EVENT_LIMIT,
        include: [{ model: db.User, as: 'employee', attributes: ['id', 'username', 'name'] }] as never
      }),
      resolveHrRecipients(),
      // Every active account, so the picker can offer anyone — including
      // admins and test logins, which are exactly who tends to need excusing
      // and who a department-scoped list would omit.
      db.User.findAll({
        where: { status: 'active' } as never,
        attributes: ['id', 'name', 'username'],
        include: [
          { model: db.Department, as: 'departmentRef', attributes: ['name'] },
          { model: db.Role, as: 'role', attributes: ['key'] }
        ] as never,
        order: [['name', 'ASC']]
      })
    ]);

    const employees = employeeRows.map((row) => {
      const plain = row.get({ plain: true }) as Record<string, unknown>;
      return {
        id: plain.id as string,
        name: (plain.name as string) || (plain.username as string),
        username: plain.username as string,
        department_name: ((plain.departmentRef as { name?: string } | null)?.name as string) ?? '',
        role: ((plain.role as { key?: string } | null)?.key as string) ?? ''
      };
    });
    const exemptSet = new Set(config.exempt_employee_ids);

    const response: DailyReportConfigResponse = {
      config,
      templates,
      available_templates: listAvailableTemplates(),
      runs: runRows.map((row) => {
        const plain = row.get({ plain: true }) as Record<string, unknown>;
        return {
          id: plain.id as string,
          started_at: isoOrEmpty(plain.started_at),
          finished_at: isoOrEmpty(plain.finished_at),
          status: (plain.status as string) ?? '',
          dry_run: Boolean(plain.dry_run),
          trigger: (plain.trigger as string) ?? '',
          stats: (plain.stats as Record<string, unknown>) ?? {},
          error: (plain.error as string) ?? ''
        };
      }),
      recent_events: eventRows.map((row) => {
        const plain = row.get({ plain: true }) as Record<string, unknown>;
        const employee = plain.employee as { name?: string; username?: string } | null;
        const date = plain.report_date;
        return {
          id: plain.id as string,
          employee_name: employee?.name ?? employee?.username ?? '',
          report_date: date instanceof Date ? date.toISOString().slice(0, 10) : String(date ?? '').slice(0, 10),
          event_key: (plain.event_key as string) ?? '',
          status: (plain.status as string) ?? '',
          processed_at: isoOrEmpty(plain.processed_at),
          due_at: isoOrEmpty(plain.due_at),
          error: (plain.error as string) ?? ''
        };
      }),
      // Surfaced so an org with nobody mapped as an HR manager in Department
      // Master can SEE that its escalations have nowhere to go, rather than
      // discovering it the month somebody crosses the threshold.
      hr_recipients: hrRecipients.map((m) => m.name || m.username),
      employees,
      exempt_employees: employees.filter((e) => exemptSet.has(e.id)),
      cron_hint: {
        path: '/api/cron/daily-report-sweep',
        secret_env: 'DAILY_REPORT_CRON_SECRET',
        configured: Boolean(process.env.DAILY_REPORT_CRON_SECRET)
      }
    };
    return NextResponse.json(response);
  } catch (error) {
    return dailyReportErrorResponse(error);
  }
}

// PATCH — either the policy (`config`) or one department's format
// (`template`). Two shapes on one endpoint because the admin page is one
// screen and both edits want the same freshly-reconciled payload back.
export async function PATCH(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canAccessDailyReportConfig(viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  try {
    if ((body as { template?: unknown }).template) {
      const template = (body as { template: Record<string, unknown> }).template;
      const departmentId = template.department_id;
      if (typeof departmentId !== 'string' || !isUuidLike(departmentId)) {
        return NextResponse.json({ error: 'A valid department_id is required.' }, { status: 400 });
      }
      const before = (await listTemplateAssignmentsForAdmin()).find((t) => t.department_id === departmentId);
      const updated = await updateTemplateAssignment(
        departmentId,
        {
          template_key: template.template_key as never,
          status: template.status as never,
          overrides: template.overrides as never,
          extra_manager_ids: template.extra_manager_ids as never,
          notes: template.notes as never
        },
        viewer.userId
      );
      await logAudit({
        by: viewer.username,
        role: viewer.role,
        entityType: 'daily_report_config',
        entityId: updated.id,
        action: `Daily report format for ${updated.departmentName} set to ${updated.templateKey}`,
        previousStatus: before ? `${before.template_key}/${before.status}` : '',
        newStatus: `${updated.templateKey}/${updated.status}`,
        ip: getClientIp(request)
      });
      return NextResponse.json({ templates: await listTemplateAssignmentsForAdmin() });
    }

    const patch = (body as { config?: Record<string, unknown> }).config;
    if (!patch) return NextResponse.json({ error: 'Send either `config` or `template`.' }, { status: 400 });

    const before = await getDailyReportConfig();
    const config = await updateDailyReportConfig(patch as never, viewer.userId);

    // The two switches that decide whether real people get mailed are worth
    // an explicit audit line of their own, not just "config updated".
    const changes: string[] = [];
    if (before.scheduler_enabled !== config.scheduler_enabled) changes.push(`scheduler ${config.scheduler_enabled ? 'ENABLED' : 'disabled'}`);
    if (before.dry_run !== config.dry_run) changes.push(`dry-run ${config.dry_run ? 'ON' : 'OFF (live notifications)'}`);
    if (before.deadline_time !== config.deadline_time) changes.push(`deadline ${before.deadline_time} -> ${config.deadline_time}`);
    // Who is excused from a compliance obligation is exactly the kind of
    // change that should be answerable from the audit log a year later.
    if (before.exempt_employee_ids.length !== config.exempt_employee_ids.length) {
      changes.push(`excused employees ${before.exempt_employee_ids.length} -> ${config.exempt_employee_ids.length}`);
    }
    if (before.warning_threshold !== config.warning_threshold) changes.push(`warning threshold ${before.warning_threshold} -> ${config.warning_threshold}`);

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'daily_report_config',
      entityId: config.id,
      action: changes.length ? `Daily report configuration: ${changes.join(', ')}` : 'Daily report configuration updated',
      previousStatus: before.scheduler_enabled ? 'scheduler on' : 'scheduler off',
      newStatus: config.scheduler_enabled ? 'scheduler on' : 'scheduler off',
      ip: getClientIp(request)
    });

    return NextResponse.json({ config });
  } catch (error) {
    return dailyReportErrorResponse(error);
  }
}
