import { Model, Op, Transaction } from 'sequelize';
import { db, isUuid } from './db';
import { DailyReportWarningGroup, DailyReportWarningRecord, DailyReportWarningSummary, DailyReportWarningStatus } from './dailyReportTypes';
import { isIsoDate, monthKey } from './dailyReportTime';
import { escalationKey, missedDatePattern, warningBanner } from './dailyReportSweepPlan';

// The missed-report ledger and its HR escalation records.
//
// Two rules that are easy to conflate and are kept apart here on purpose:
//
//   * A warning is recorded for EVERY missed working day, indefinitely. The
//     count does not stop at three.
//   * An HR escalation is sent ONCE per employee per calendar month, the
//     first time the active count reaches the threshold. The cap is the
//     unique (employee_id, month_key) index, not a count of emails — so a
//     retry mid-send collides with the row instead of sending a second one.
//
// And one that matters for trust: a warning is never deleted. Waiving sets
// status to 'WAIVED', which removes it from the active count while leaving
// it visible, attributed and explained in the employee's history.

export class DailyReportWarningError extends Error {}

function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

function dateOnly(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

const INCLUDES = [
  { model: db.User, as: 'employee', attributes: ['id', 'username', 'name'] },
  { model: db.Department, as: 'department', attributes: ['id', 'name'] },
  { model: db.User, as: 'waivedBy', attributes: ['id', 'username', 'name'] }
];

function toRecord(row: Model): DailyReportWarningRecord {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const employee = plain.employee as { name?: string; username?: string } | null;
  const waivedBy = plain.waivedBy as { name?: string; username?: string } | null;
  return {
    id: plain.id as string,
    employee_id: plain.employee_id as string,
    employee_name: employee?.name ?? employee?.username ?? '',
    department_name: (plain.department as { name?: string } | null)?.name ?? '',
    report_date: dateOnly(plain.report_date),
    month_key: (plain.month_key as string) ?? '',
    status: plain.status as DailyReportWarningStatus,
    source: (plain.source as string) ?? 'scheduler',
    waived_by_name: waivedBy?.name ?? waivedBy?.username ?? '',
    waived_at: isoOrEmpty(plain.waived_at),
    waiver_reason: (plain.waiver_reason as string) ?? '',
    created_at: isoOrEmpty(plain.createdAt)
  };
}

export interface RecordWarningInput {
  employeeId: string;
  departmentId: string | null;
  reportDate: string;
  /**
   * 'scheduler' (missed entirely) | 'leave_rejected' (reinstated obligation)
   * | 'zero_total' (filed, but the auto-fetched Sales/GEM-Sales total was
   * zero for a second consecutive reporting day — see planZeroTotalWarnings
   * in lib/dailyReportSweepPlan.ts). A zero_total warning can never collide
   * with the other two on the same date: both of those only ever fire for a
   * date that was NOT submitted, and zero_total only ever fires for one that
   * was.
   */
  source?: 'scheduler' | 'leave_rejected' | 'zero_total';
}

/**
 * Records one missed working day, idempotently.
 *
 * Returns null when a warning for that (employee, date) already exists —
 * the unique index makes a second one impossible, and the caller treats
 * "already there" as success rather than as an error, which is what lets the
 * sweep be retried as often as the host's cron likes.
 */
export async function recordWarning(input: RecordWarningInput, t?: Transaction): Promise<DailyReportWarningRecord | null> {
  if (!isIsoDate(input.reportDate)) throw new DailyReportWarningError('A valid reporting date is required.');
  try {
    const row = await db.DailyReportWarning.create(
      {
        employee_id: input.employeeId,
        department_id: input.departmentId,
        report_date: input.reportDate,
        month_key: monthKey(input.reportDate),
        status: 'ACTIVE',
        source: input.source ?? 'scheduler'
      } as never,
      t ? { transaction: t } : undefined
    );
    return (await findWarningById(row.get('id') as string)) ?? null;
  } catch (error) {
    if ((error as { name?: string }).name === 'SequelizeUniqueConstraintError') return null;
    throw error;
  }
}

export async function findWarningById(id: string): Promise<DailyReportWarningRecord | null> {
  if (!isUuid(id)) return null;
  const row = await db.DailyReportWarning.findByPk(id, { include: INCLUDES as never });
  return row ? toRecord(row) : null;
}

/**
 * HR waives one warning. The reason is mandatory — a waiver with no stated
 * reason is indistinguishable from a mistake six months later, and this
 * record is the thing an employee might later be asked about.
 */
export async function waiveWarning(id: string, waivedByUserId: string, reason: string): Promise<DailyReportWarningRecord> {
  if (!isUuid(id)) throw new DailyReportWarningError('Warning not found.');
  const trimmed = (reason || '').trim();
  if (!trimmed) throw new DailyReportWarningError('A reason is required to waive a warning.');
  if (trimmed.length > 2000) throw new DailyReportWarningError('Keep the reason under 2000 characters.');

  const row = await db.DailyReportWarning.findByPk(id);
  if (!row) throw new DailyReportWarningError('Warning not found.');
  if (row.get('status') === 'WAIVED') throw new DailyReportWarningError('This warning has already been waived.');

  await row.update({ status: 'WAIVED', waived_by: waivedByUserId, waived_at: new Date(), waiver_reason: trimmed } as never);
  return (await findWarningById(id)) as DailyReportWarningRecord;
}

/** Reinstates a waived warning — the undo for a waiver applied in error. */
export async function reinstateWarning(id: string, reason: string): Promise<DailyReportWarningRecord> {
  if (!isUuid(id)) throw new DailyReportWarningError('Warning not found.');
  const row = await db.DailyReportWarning.findByPk(id);
  if (!row) throw new DailyReportWarningError('Warning not found.');
  if (row.get('status') !== 'WAIVED') throw new DailyReportWarningError('This warning is already active.');
  await row.update({ status: 'ACTIVE', waived_by: null, waived_at: null, waiver_reason: (reason || '').trim() || null } as never);
  return (await findWarningById(id)) as DailyReportWarningRecord;
}

/**
 * 'employeeId|YYYY-MM' -> ACTIVE warning count.
 *
 * Waived warnings are excluded, which is what makes waiving the third one
 * genuinely take somebody back below the threshold rather than merely
 * annotating the row.
 */
export async function loadActiveCountsByMonth(employeeIds: string[], monthKeys: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!employeeIds.length || !monthKeys.length) return map;
  const rows = await db.DailyReportWarning.findAll({
    attributes: ['employee_id', 'month_key', [db.Sequelize.fn('COUNT', db.Sequelize.col('id')), 'count']],
    where: { employee_id: employeeIds, month_key: monthKeys, status: 'ACTIVE' } as never,
    group: ['employee_id', 'month_key']
  });
  for (const row of rows) {
    map.set(escalationKey(row.get('employee_id') as string, row.get('month_key') as string), Number(row.get('count')) || 0);
  }
  return map;
}

/**
 * `sources`, when given, narrows to warnings recorded for one of those
 * reasons only. Needed by the zero-total-streak check: a date can carry a
 * 'scheduler' (missed entirely) warning from BEFORE it was later
 * auto-submitted — that date's one (employee, date) slot is occupied, but
 * by an unrelated warning, not a zero_total one, so the zero-total check
 * must not read it as "already warned about zero activity" and silently
 * suppress the dedicated check for it.
 */
export async function loadWarningKeys(employeeIds: string[], from: string, to: string, sources?: string[]): Promise<Set<string>> {
  if (!employeeIds.length) return new Set();
  const where: Record<string, unknown> = { employee_id: employeeIds, report_date: { [Op.between]: [from, to] } };
  if (sources?.length) where.source = sources;
  const rows = await db.DailyReportWarning.findAll({ where: where as never, attributes: ['employee_id', 'report_date'] });
  return new Set(rows.map((r) => `${r.get('employee_id') as string}|${dateOnly(r.get('report_date'))}`));
}

export async function loadWarningStatusByDate(employeeId: string, from: string, to: string): Promise<Map<string, DailyReportWarningStatus>> {
  const map = new Map<string, DailyReportWarningStatus>();
  if (!isUuid(employeeId)) return map;
  const rows = await db.DailyReportWarning.findAll({
    where: { employee_id: employeeId, report_date: { [Op.between]: [from, to] } } as never,
    attributes: ['report_date', 'status']
  });
  for (const row of rows) map.set(dateOnly(row.get('report_date')), row.get('status') as DailyReportWarningStatus);
  return map;
}

export async function countWarningsByStatus(employeeIds: string[], monthKeys: string[]): Promise<{ employeeId: string; status: DailyReportWarningStatus; count: number }[]> {
  if (!employeeIds.length || !monthKeys.length) return [];
  const rows = await db.DailyReportWarning.findAll({
    attributes: ['employee_id', 'status', [db.Sequelize.fn('COUNT', db.Sequelize.col('id')), 'count']],
    where: { employee_id: employeeIds, month_key: monthKeys } as never,
    group: ['employee_id', 'status']
  });
  return rows.map((row) => ({
    employeeId: row.get('employee_id') as string,
    status: row.get('status') as DailyReportWarningStatus,
    count: Number(row.get('count')) || 0
  }));
}

// --------------------------------------------------------------------------
// Escalations
// --------------------------------------------------------------------------

export interface EscalationRecord {
  id: string;
  employeeId: string;
  monthKey: string;
  warningCount: number;
  missedDates: string[];
  notifiedAt: string;
  notifiedUsernames: string[];
  emailStatus: string;
  emailError: string;
}

function toEscalation(row: Model): EscalationRecord {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  return {
    id: plain.id as string,
    employeeId: plain.employee_id as string,
    monthKey: plain.month_key as string,
    warningCount: Number(plain.warning_count) || 0,
    missedDates: Array.isArray(plain.missed_dates) ? (plain.missed_dates as string[]) : [],
    notifiedAt: isoOrEmpty(plain.notified_at),
    notifiedUsernames: Array.isArray(plain.notified_usernames) ? (plain.notified_usernames as string[]) : [],
    emailStatus: (plain.email_status as string) ?? 'pending',
    emailError: (plain.email_error as string) ?? ''
  };
}

/**
 * Claims the single monthly escalation slot for an employee.
 *
 * Returns null if it was already claimed — which is the whole point: the
 * caller only sends the HR email when it gets a row back, so two concurrent
 * sweeps produce one email between them, not two. The row is written BEFORE
 * the send (email_status 'pending', updated afterwards), so a crash between
 * the two loses an email rather than duplicating one.
 */
export async function claimEscalation(employeeId: string, month: string, warningCount: number, missedDates: string[]): Promise<EscalationRecord | null> {
  try {
    const row = await db.DailyReportEscalation.create({
      employee_id: employeeId,
      month_key: month,
      warning_count: warningCount,
      missed_dates: missedDates,
      email_status: 'pending'
    } as never);
    return toEscalation(row);
  } catch (error) {
    if ((error as { name?: string }).name === 'SequelizeUniqueConstraintError') return null;
    throw error;
  }
}

export async function markEscalationNotified(id: string, usernames: string[], status: 'sent' | 'failed' | 'dry_run', error?: string): Promise<void> {
  await db.DailyReportEscalation.update(
    { notified_at: new Date(), notified_usernames: usernames, email_status: status, email_error: error ?? null } as never,
    { where: { id } as never }
  );
}

export async function loadEscalatedKeys(employeeIds: string[], monthKeys: string[]): Promise<Set<string>> {
  if (!employeeIds.length || !monthKeys.length) return new Set();
  const rows = await db.DailyReportEscalation.findAll({
    where: { employee_id: employeeIds, month_key: monthKeys } as never,
    attributes: ['employee_id', 'month_key']
  });
  return new Set(rows.map((r) => escalationKey(r.get('employee_id') as string, r.get('month_key') as string)));
}

export async function loadEscalations(employeeIds: string[], monthKeys: string[]): Promise<Map<string, EscalationRecord>> {
  const map = new Map<string, EscalationRecord>();
  if (!employeeIds.length || !monthKeys.length) return map;
  const rows = await db.DailyReportEscalation.findAll({ where: { employee_id: employeeIds, month_key: monthKeys } as never });
  for (const row of rows) {
    const record = toEscalation(row);
    map.set(escalationKey(record.employeeId, record.monthKey), record);
  }
  return map;
}

// --------------------------------------------------------------------------
// Views
// --------------------------------------------------------------------------

/** The employee's own banner + this month's warnings, active and waived. */
export async function buildWarningSummary(employeeId: string, month: string, threshold: number): Promise<DailyReportWarningSummary> {
  const [rows, escalations] = await Promise.all([
    db.DailyReportWarning.findAll({
      where: { employee_id: employeeId, month_key: month } as never,
      include: INCLUDES as never,
      order: [['report_date', 'DESC']]
    }),
    loadEscalatedKeys([employeeId], [month])
  ]);
  const warnings = rows.map(toRecord);
  const active = warnings.filter((w) => w.status === 'ACTIVE').length;
  const escalated = escalations.has(escalationKey(employeeId, month));
  return {
    month_key: month,
    active_count: active,
    waived_count: warnings.length - active,
    threshold,
    escalated,
    banner: warningBanner(active, threshold, escalated),
    warnings
  };
}

export interface WarningGroupFilters {
  employeeIds?: string[];
  departmentIds?: string[];
  monthKey?: string;
  /** 'all' | 'active' | 'escalated' */
  view?: 'all' | 'active' | 'escalated';
  search?: string;
}

/**
 * The HR Warnings tab: one group per employee per month.
 *
 * Grouped here rather than in SQL because the group also needs the
 * consecutive/scattered pattern and the escalation flag, and the row volume
 * for one month is small — a month of warnings across an org this size is
 * tens of rows, not thousands.
 */
export async function listWarningGroups(filters: WarningGroupFilters = {}, threshold = 3): Promise<DailyReportWarningGroup[]> {
  const where: Record<string | symbol, unknown> = {};
  if (filters.employeeIds) where.employee_id = filters.employeeIds;
  if (filters.departmentIds?.length) where.department_id = filters.departmentIds;
  if (filters.monthKey) where.month_key = filters.monthKey;

  const search = (filters.search ?? '').trim();
  const include = search
    ? [
        { ...INCLUDES[0], where: { [Op.or]: [{ name: { [Op.iLike]: `%${search}%` } }, { username: { [Op.iLike]: `%${search}%` } }] }, required: true },
        INCLUDES[1],
        INCLUDES[2]
      ]
    : INCLUDES;

  const rows = await db.DailyReportWarning.findAll({ where: where as never, include: include as never, order: [['report_date', 'DESC']] });
  const warnings = rows.map(toRecord);
  if (!warnings.length) return [];

  const escalations = await loadEscalations(
    Array.from(new Set(warnings.map((w) => w.employee_id))),
    Array.from(new Set(warnings.map((w) => w.month_key)))
  );

  const groups = new Map<string, DailyReportWarningGroup>();
  for (const warning of warnings) {
    const key = escalationKey(warning.employee_id, warning.month_key);
    let group = groups.get(key);
    if (!group) {
      const escalation = escalations.get(key);
      group = {
        employee_id: warning.employee_id,
        employee_name: warning.employee_name,
        department_name: warning.department_name,
        month_key: warning.month_key,
        active_warnings: 0,
        waived_warnings: 0,
        missed_dates: [],
        pattern: 'none',
        hr_escalated: !!escalation,
        hr_escalated_at: escalation?.notifiedAt ?? '',
        warnings: []
      };
      groups.set(key, group);
    }
    group.warnings.push(warning);
    if (warning.status === 'ACTIVE') {
      group.active_warnings += 1;
      group.missed_dates.push(warning.report_date);
    } else {
      group.waived_warnings += 1;
    }
  }

  let result = [...groups.values()].map((group) => ({ ...group, pattern: missedDatePattern(group.missed_dates) }));
  if (filters.view === 'active') result = result.filter((g) => g.active_warnings > 0);
  if (filters.view === 'escalated') result = result.filter((g) => g.hr_escalated || g.active_warnings >= threshold);

  // Worst first — the people HR needs to look at today are at the top.
  return result.sort(
    (a, b) => b.month_key.localeCompare(a.month_key) || b.active_warnings - a.active_warnings || a.employee_name.localeCompare(b.employee_name)
  );
}
