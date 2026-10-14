import { Model, Op, Transaction } from 'sequelize';
import { db, isUuid } from './db';
import {
  DailyReportEntryRecord,
  DailyReportHistoryItem,
  DailyReportRecord,
  DailyReportRevisionRecord,
  DailyReportReviewStatus,
  DailyReportSubmissionStatus
} from './dailyReportTypes';
import {
  DailyReportPayloadInput,
  EMPTY_PAYLOAD,
  TemplateDefinition,
  computeDerivedValues,
  isEntryOverdue,
  validateReportPayload
} from './dailyReportTemplates';
import { DeadlinePolicy, isIsoDate, isLateSubmission, scheduleFor } from './dailyReportTime';
import { resolveTemplateForDepartment, resolveTemplateForStoredReport } from './dailyReportTemplateStore';
import { getDeadlinePolicy } from './dailyReportConfigStore';

// Reports, their entries, and their revision history.
//
// Three invariants are enforced here rather than at any call site, because
// every one of them is a thing the brief calls out and all four write paths
// (employee draft, employee submit, manager edit, manager file-for-them)
// would otherwise each have to remember:
//
//   1. submitted_at is written ONCE. A later edit records a revision and
//      touches updated_at; it never moves the original submission instant,
//      and therefore never retroactively turns a late report into an on-time
//      one or vice versa. is_late and deadline_at are frozen with it.
//   2. One report per (employee, department, date). The partial unique index
//      in the migration is the real guarantee; the duplicate branch below
//      only turns the raw Postgres violation into a sentence a person can
//      read, because two browser tabs really do race here.
//   3. Nothing is written without passing validateReportPayload against the
//      department's RESOLVED template — the same validator the client uses,
//      so a hand-made request can't store a shape the manager view can't
//      render.

export const SUBMITTED_STATUSES: DailyReportSubmissionStatus[] = ['SUBMITTED', 'SUBMITTED_LATE'];

export class DailyReportValidationError extends Error {
  issues: { path: string; message: string }[];
  constructor(message: string, issues: { path: string; message: string }[] = []) {
    super(message);
    this.issues = issues;
  }
}
export class DailyReportNotFoundError extends Error {}
export class DailyReportConflictError extends Error {}

function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

// NOTE on timestamp keys: these models use `underscored: true` with
// Sequelize's automatic timestamps, so the COLUMN is created_at but the
// ATTRIBUTE — and therefore the key in row.get({ plain: true }) — is
// createdAt. Reading plain.created_at here returns undefined and renders a
// blank date. (The two general_task_* models in this repo genuinely do read
// plain.created_at, but only because they explicitly rename the attribute
// with `createdAt: 'created_at'` in their model options; these do not.)

function dateOnly(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

const REPORT_INCLUDES = [
  { model: db.User, as: 'employee', attributes: ['id', 'username', 'name'] },
  { model: db.Department, as: 'department', attributes: ['id', 'name'] },
  { model: db.User, as: 'reviewer', attributes: ['id', 'username', 'name'] },
  { model: db.User, as: 'filedBy', attributes: ['id', 'username', 'name'] },
  { model: db.DailyReportEntry, as: 'entries', attributes: ['id', 'position', 'data'], required: false }
];

function personName(value: unknown): string {
  const person = value as { name?: string; username?: string } | null;
  return person?.name ?? person?.username ?? '';
}

/**
 * A stored row plus the template it must be read with, as the API record.
 *
 * The derived columns (Task ID, Days Left) are computed here on every read
 * rather than stored: days-left relative to a fixed reporting date is a pure
 * function of the due date, and persisting it would leave a stale "4 days
 * left" behind the moment a row is edited — while recomputing guarantees the
 * number the employee sees is the same one analytics calls overdue.
 */
function toRecord(row: Model, template: TemplateDefinition): DailyReportRecord {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const reportDate = dateOnly(plain.report_date);
  const rawEntries = (Array.isArray(plain.entries) ? plain.entries : []) as { id: string; position: number; data: Record<string, unknown> }[];
  const sorted = [...rawEntries].sort((a, b) => a.position - b.position);

  const entries: DailyReportEntryRecord[] = sorted.map((entry, index) => ({
    id: entry.id,
    position: entry.position,
    data: entry.data ?? {},
    derived: computeDerivedValues(template, reportDate, entry.data ?? {}, index),
    overdue: isEntryOverdue(template, reportDate, entry.data ?? {}, index)
  }));

  return {
    id: plain.id as string,
    employee_id: plain.employee_id as string,
    employee_name: personName(plain.employee),
    employee_username: (plain.employee as { username?: string } | null)?.username ?? '',
    department_id: plain.department_id as string,
    department_name: (plain.department as { name?: string } | null)?.name ?? '',
    report_date: reportDate,
    template_key: plain.template_key as DailyReportRecord['template_key'],
    submission_status: plain.submission_status as DailyReportSubmissionStatus,
    review_status: plain.review_status as DailyReportReviewStatus,
    payload: (plain.payload as Record<string, unknown>) ?? {},
    matrix: (plain.matrix as Record<string, Record<string, number>>) ?? {},
    entries,
    submitted_at: isoOrEmpty(plain.submitted_at),
    is_late: Boolean(plain.is_late),
    deadline_at: isoOrEmpty(plain.deadline_at),
    reviewed_by_name: personName(plain.reviewer),
    reviewed_at: isoOrEmpty(plain.reviewed_at),
    review_note: (plain.review_note as string) ?? '',
    filed_by_name: personName(plain.filedBy),
    created_at: isoOrEmpty(plain.createdAt),
    updated_at: isoOrEmpty(plain.updatedAt)
  };
}

async function hydrate(id: string): Promise<DailyReportRecord> {
  const row = await db.DailyReport.findByPk(id, { include: REPORT_INCLUDES as never });
  if (!row) throw new DailyReportNotFoundError('Report not found.');
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const template = await resolveTemplateForStoredReport(plain.department_id as string, plain.template_key as DailyReportRecord['template_key']);
  return toRecord(row, template);
}

export async function findReportById(id: string): Promise<DailyReportRecord | null> {
  if (!isUuid(id)) return null;
  try {
    return await hydrate(id);
  } catch (error) {
    if (error instanceof DailyReportNotFoundError) return null;
    throw error;
  }
}

export async function findReportForDate(employeeId: string, departmentId: string, reportDate: string): Promise<DailyReportRecord | null> {
  if (!isUuid(employeeId) || !isUuid(departmentId) || !isIsoDate(reportDate)) return null;
  const row = await db.DailyReport.findOne({
    where: { employee_id: employeeId, department_id: departmentId, report_date: reportDate } as never,
    attributes: ['id']
  });
  return row ? hydrate(row.get('id') as string) : null;
}

// --------------------------------------------------------------------------
// Writing
// --------------------------------------------------------------------------

export type SaveMode = 'draft' | 'submit';

export interface SaveReportInput {
  employeeId: string;
  departmentId: string;
  reportDate: string;
  /** Omitted on a bare submit of already-saved content. */
  payload?: DailyReportPayloadInput;
  mode: SaveMode;
  actorId: string;
  /** True when a manager is filing for someone else — recorded, not implied. */
  onBehalf: boolean;
}

export interface SaveReportResult {
  report: DailyReportRecord;
  /**
   * True only on the transition into a submitted state. The caller notifies
   * managers on this and nothing else, which — together with the
   * 'SUBMITTED' row in the notification ledger — is what stops a double-click
   * or a retried request from mailing a manager twice.
   */
  justSubmitted: boolean;
}

function isDuplicateKeyError(error: unknown): boolean {
  // Sequelize wraps it, but the useful signal is the constraint name — this
  // is specifically the (employee_id, department_id, report_date) index, not
  // any other unique violation, so a genuine bug elsewhere still surfaces.
  const e = error as { name?: string; parent?: { constraint?: string }; original?: { constraint?: string } };
  if (e?.name !== 'SequelizeUniqueConstraintError') return false;
  const constraint = e.parent?.constraint || e.original?.constraint || '';
  return constraint.includes('daily_reports_employee_department_date_unique') || constraint === '';
}

async function replaceEntries(reportId: string, entries: Record<string, unknown>[], t: Transaction): Promise<void> {
  // Replace-all rather than diff-and-patch. The client owns the row order
  // (add/remove/reorder are all one edit to it), so reconciling by id would
  // be more code for an identical result — and a hard-deleted previous
  // generation is fine because the content of every revision is preserved in
  // daily_report_revisions.
  await db.DailyReportEntry.destroy({ where: { report_id: reportId } as never, force: true, transaction: t });
  if (!entries.length) return;
  await db.DailyReportEntry.bulkCreate(
    entries.map((data, position) => ({ report_id: reportId, position, data })) as never,
    { transaction: t }
  );
}

async function recordRevision(
  reportId: string,
  actorId: string | null,
  action: string,
  submissionStatus: string,
  snapshot: { payload: Record<string, unknown>; matrix: Record<string, unknown>; entries: Record<string, unknown>[] },
  note: string,
  t: Transaction
): Promise<void> {
  await db.DailyReportRevision.create(
    { report_id: reportId, actor_id: actorId, action, submission_status: submissionStatus, snapshot, note },
    { transaction: t } as never
  );
}

/**
 * Create-or-update, draft-or-submit, by the employee or by a manager on
 * their behalf — one function, because the validation, the duplicate rule,
 * the revision trail and the submitted_at invariant must be identical for
 * all four and were never going to stay identical across four copies.
 */
export async function saveReport(input: SaveReportInput): Promise<SaveReportResult> {
  if (!isIsoDate(input.reportDate)) throw new DailyReportValidationError('A valid reporting date is required.');

  const [resolved, policy] = await Promise.all([resolveTemplateForDepartment(input.departmentId), getDeadlinePolicy()]);
  if (!resolved.configured) {
    throw new DailyReportValidationError('This department’s daily report format is not configured yet, so a report cannot be filed.');
  }

  // A future reporting date can't be reported on yet. Checked against the
  // IST calendar day, not the server's, so a server in UTC doesn't reject
  // "today" for the first 5.5 hours of it.
  const todayIst = dateOnly(new Date(Date.now() + 330 * 60_000));
  if (input.reportDate > todayIst) {
    throw new DailyReportValidationError('A report can only be filed for today or an earlier date.');
  }

  const existing = await db.DailyReport.findOne({
    where: { employee_id: input.employeeId, department_id: input.departmentId, report_date: input.reportDate } as never
  });

  // On a bare submit (no payload posted) the stored content is what gets
  // validated and submitted — the employee is confirming what they already
  // saved, so re-sending it from the client would only create a window for
  // the two to disagree.
  let payload: DailyReportPayloadInput;
  if (input.payload) {
    payload = input.payload;
  } else if (existing) {
    const storedEntries = await db.DailyReportEntry.findAll({
      where: { report_id: existing.get('id') as string } as never,
      order: [['position', 'ASC']]
    });
    payload = {
      header: (existing.get('payload') as Record<string, unknown>) ?? {},
      matrix: (existing.get('matrix') as Record<string, Record<string, unknown>>) ?? {},
      entries: storedEntries.map((e) => (e.get('data') as Record<string, unknown>) ?? {})
    };
  } else {
    payload = EMPTY_PAYLOAD;
  }

  // strict only on submit: a draft is explicitly a private scratchpad and
  // must be saveable half-finished.
  const validation = validateReportPayload(resolved.template, payload, input.mode === 'submit');
  if (!validation.ok) {
    throw new DailyReportValidationError(
      input.mode === 'submit' ? 'This report is not complete yet.' : 'This report could not be saved.',
      validation.issues
    );
  }

  const now = new Date();
  const schedule = scheduleFor(input.reportDate, policy);
  const late = isLateSubmission(input.reportDate, now, policy);
  const submittedStatus: DailyReportSubmissionStatus = late ? 'SUBMITTED_LATE' : 'SUBMITTED';

  let justSubmitted = false;

  const reportId = await db.sequelize.transaction(async (t) => {
    const snapshot = { payload: validation.normalized.header, matrix: validation.normalized.matrix, entries: validation.normalized.entries };

    if (!existing) {
      const attrs: Record<string, unknown> = {
        employee_id: input.employeeId,
        department_id: input.departmentId,
        report_date: input.reportDate,
        template_key: resolved.templateKey,
        submission_status: input.mode === 'submit' ? submittedStatus : 'DRAFT',
        review_status: 'NOT_REVIEWED',
        payload: validation.normalized.header,
        matrix: validation.normalized.matrix,
        created_by: input.actorId,
        updated_by: input.actorId,
        filed_by_user_id: input.onBehalf ? input.actorId : null
      };
      if (input.mode === 'submit') {
        attrs.submitted_at = now;
        attrs.is_late = late;
        attrs.deadline_at = schedule.deadlineAt;
        justSubmitted = true;
      }
      let created: Model;
      try {
        created = await db.DailyReport.create(attrs as never, { transaction: t });
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          throw new DailyReportConflictError('A report for this date already exists — reload the page to see it.');
        }
        throw error;
      }
      const id = created.get('id') as string;
      await replaceEntries(id, validation.normalized.entries, t);
      await recordRevision(
        id,
        input.actorId,
        input.onBehalf ? 'filed_for_employee' : input.mode === 'submit' ? 'submitted' : 'created',
        attrs.submission_status as string,
        snapshot,
        '',
        t
      );
      return id;
    }

    const id = existing.get('id') as string;
    const wasSubmitted = SUBMITTED_STATUSES.includes(existing.get('submission_status') as DailyReportSubmissionStatus);

    const attrs: Record<string, unknown> = {
      payload: validation.normalized.header,
      matrix: validation.normalized.matrix,
      updated_by: input.actorId
    };

    if (input.mode === 'submit' && !wasSubmitted) {
      attrs.submission_status = submittedStatus;
      // These three are the immutable set, written here and nowhere else.
      attrs.submitted_at = now;
      attrs.is_late = late;
      attrs.deadline_at = schedule.deadlineAt;
      justSubmitted = true;
      // A manager-filed submission is recorded as such even if the employee
      // had already started the draft themselves.
      if (input.onBehalf) attrs.filed_by_user_id = input.actorId;
    } else if (input.mode === 'submit' && wasSubmitted) {
      // Re-submitting an already-submitted report is an EDIT. submitted_at,
      // is_late and deadline_at are deliberately absent from attrs, so the
      // original verdict stands no matter how many times this is called.
      attrs.submission_status = existing.get('submission_status');
    }

    // Editing a report a manager had flagged clears the flag: the employee
    // has responded, and leaving CHANGES_REQUESTED on screen would make the
    // manager's queue permanently wrong.
    if (wasSubmitted && existing.get('review_status') === 'CHANGES_REQUESTED') {
      attrs.review_status = 'NOT_REVIEWED';
    }

    await existing.update(attrs as never, { transaction: t });
    await replaceEntries(id, validation.normalized.entries, t);
    await recordRevision(
      id,
      input.actorId,
      justSubmitted ? (input.onBehalf ? 'filed_for_employee' : 'submitted') : wasSubmitted ? 'edited' : 'draft_saved',
      (attrs.submission_status as string) ?? (existing.get('submission_status') as string),
      snapshot,
      '',
      t
    );
    return id;
  });

  return { report: await hydrate(reportId), justSubmitted };
}

/** Submit a report that already exists, by id. */
export async function submitReportById(id: string, actorId: string, onBehalf = false): Promise<SaveReportResult> {
  const row = await db.DailyReport.findByPk(id);
  if (!row) throw new DailyReportNotFoundError('Report not found.');
  return saveReport({
    employeeId: row.get('employee_id') as string,
    departmentId: row.get('department_id') as string,
    reportDate: dateOnly(row.get('report_date')),
    mode: 'submit',
    actorId,
    onBehalf
  });
}

export async function reviewReport(
  id: string,
  reviewStatus: Exclude<DailyReportReviewStatus, 'NOT_REVIEWED'>,
  note: string,
  reviewerId: string
): Promise<DailyReportRecord> {
  if (!isUuid(id)) throw new DailyReportNotFoundError('Report not found.');
  const row = await db.DailyReport.findByPk(id);
  if (!row) throw new DailyReportNotFoundError('Report not found.');
  if (!SUBMITTED_STATUSES.includes(row.get('submission_status') as DailyReportSubmissionStatus)) {
    // A draft is private to its owner — a manager cannot read it, so they
    // certainly cannot review it.
    throw new DailyReportValidationError('Only a submitted report can be reviewed.');
  }
  if (reviewStatus === 'CHANGES_REQUESTED' && !note.trim()) {
    throw new DailyReportValidationError('Say what needs changing — a note is required when requesting changes.');
  }

  await db.sequelize.transaction(async (t) => {
    await row.update(
      { review_status: reviewStatus, reviewed_by: reviewerId, reviewed_at: new Date(), review_note: note.trim() } as never,
      { transaction: t }
    );
    // Reviewing records a revision with no snapshot content — the report's
    // own text did not change, only the manager's verdict on it.
    await recordRevision(id, reviewerId, 'reviewed', row.get('submission_status') as string, { payload: {}, matrix: {}, entries: [] }, note.trim(), t);
  });

  return hydrate(id);
}

// --------------------------------------------------------------------------
// Reading in bulk
// --------------------------------------------------------------------------

export interface ReportLookupKey {
  employeeId: string;
  reportDate: string;
}

function lookupKey(employeeId: string, reportDate: string): string {
  return `${employeeId}|${reportDate}`;
}

/**
 * subjectKey -> status, for every report in a date range. Used by the
 * manager dashboard, analytics, the history strip and the scheduler, all of
 * which need "did these people file on these days" without N queries.
 */
export async function loadReportStatuses(
  employeeIds: string[],
  from: string,
  to: string
): Promise<Map<string, { id: string; submission_status: DailyReportSubmissionStatus; review_status: DailyReportReviewStatus; submitted_at: string; is_late: boolean; filed_by_name: string; entry_count: number }>> {
  const map = new Map<string, { id: string; submission_status: DailyReportSubmissionStatus; review_status: DailyReportReviewStatus; submitted_at: string; is_late: boolean; filed_by_name: string; entry_count: number }>();
  if (!employeeIds.length) return map;

  const rows = await db.DailyReport.findAll({
    where: { employee_id: employeeIds, report_date: { [Op.between]: [from, to] } } as never,
    attributes: ['id', 'employee_id', 'report_date', 'submission_status', 'review_status', 'submitted_at', 'is_late'],
    include: [
      { model: db.User, as: 'filedBy', attributes: ['id', 'username', 'name'] },
      { model: db.DailyReportEntry, as: 'entries', attributes: ['id'], required: false }
    ] as never
  });

  for (const row of rows) {
    const plain = row.get({ plain: true }) as Record<string, unknown>;
    map.set(lookupKey(plain.employee_id as string, dateOnly(plain.report_date)), {
      id: plain.id as string,
      submission_status: plain.submission_status as DailyReportSubmissionStatus,
      review_status: plain.review_status as DailyReportReviewStatus,
      submitted_at: isoOrEmpty(plain.submitted_at),
      is_late: Boolean(plain.is_late),
      filed_by_name: personName(plain.filedBy),
      entry_count: Array.isArray(plain.entries) ? plain.entries.length : 0
    });
  }
  return map;
}

/**
 * subjectKey set for reports that are genuinely SUBMITTED.
 *
 * A DRAFT is deliberately excluded — the brief is explicit that a saved
 * draft neither satisfies the filing requirement nor suppresses a reminder,
 * and this set is what the scheduler consults before warning somebody.
 */
export async function loadSubmittedKeys(employeeIds: string[], from: string, to: string): Promise<Set<string>> {
  if (!employeeIds.length) return new Set();
  const rows = await db.DailyReport.findAll({
    where: {
      employee_id: employeeIds,
      report_date: { [Op.between]: [from, to] },
      submission_status: SUBMITTED_STATUSES
    } as never,
    attributes: ['employee_id', 'report_date']
  });
  return new Set(rows.map((r) => lookupKey(r.get('employee_id') as string, dateOnly(r.get('report_date')))));
}

export async function listRevisions(reportId: string): Promise<DailyReportRevisionRecord[]> {
  if (!isUuid(reportId)) return [];
  const rows = await db.DailyReportRevision.findAll({
    where: { report_id: reportId } as never,
    include: [{ model: db.User, as: 'actor', attributes: ['id', 'username', 'name'] }] as never,
    order: [['at', 'DESC']]
  });
  return rows.map((row) => {
    const plain = row.get({ plain: true }) as Record<string, unknown>;
    return {
      id: plain.id as string,
      at: isoOrEmpty(plain.at),
      actor_name: personName(plain.actor),
      action: (plain.action as string) ?? '',
      submission_status: (plain.submission_status as string) ?? '',
      note: (plain.note as string) ?? ''
    };
  });
}

/**
 * The employee's own recent reporting days, newest first — including the
 * days with NO report, which are the ones that matter. A list of only the
 * reports that exist would quietly hide exactly what this strip is for.
 */
export async function buildHistory(
  employeeId: string,
  reportDates: string[],
  leaveByDate: Map<string, DailyReportHistoryItem['leave_status']>,
  warningByDate: Map<string, DailyReportHistoryItem['warning_status']>
): Promise<DailyReportHistoryItem[]> {
  if (!reportDates.length) return [];
  const sorted = [...reportDates].sort();
  const statuses = await loadReportStatuses([employeeId], sorted[0], sorted[sorted.length - 1]);
  return [...sorted].reverse().map((reportDate) => {
    const found = statuses.get(lookupKey(employeeId, reportDate));
    return {
      report_date: reportDate,
      submission_status: found ? found.submission_status : 'MISSING',
      review_status: found ? found.review_status : '',
      submitted_at: found?.submitted_at ?? '',
      is_late: found?.is_late ?? false,
      leave_status: leaveByDate.get(reportDate) ?? '',
      warning_status: warningByDate.get(reportDate) ?? '',
      report_id: found?.id ?? ''
    };
  });
}

/** Counts for the analytics endpoint, grouped in SQL rather than in memory. */
export async function countReportsByStatus(employeeIds: string[], from: string, to: string): Promise<{ employeeId: string; status: DailyReportSubmissionStatus; managerFiled: boolean; count: number }[]> {
  if (!employeeIds.length) return [];
  const rows = await db.DailyReport.findAll({
    attributes: [
      'employee_id',
      'submission_status',
      [db.Sequelize.literal('(filed_by_user_id IS NOT NULL)'), 'manager_filed'],
      [db.Sequelize.fn('COUNT', db.Sequelize.col('DailyReport.id')), 'count']
    ],
    where: { employee_id: employeeIds, report_date: { [Op.between]: [from, to] } } as never,
    group: ['employee_id', 'submission_status', db.Sequelize.literal('(filed_by_user_id IS NOT NULL)')] as never
  });
  return rows.map((row) => {
    const plain = row.get({ plain: true }) as Record<string, unknown>;
    return {
      employeeId: plain.employee_id as string,
      status: plain.submission_status as DailyReportSubmissionStatus,
      managerFiled: Boolean(plain.manager_filed),
      count: Number(plain.count) || 0
    };
  });
}

/** Re-exported so callers don't each re-derive the policy shape. */
export type { DeadlinePolicy };
