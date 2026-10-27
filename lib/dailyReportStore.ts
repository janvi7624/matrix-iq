import { Model, Op, Transaction } from 'sequelize';
import { db, isUuid } from './db';
import {
  DailyReportEntryRecord,
  DailyReportHistoryItem,
  DailyReportRecord,
  DailyReportRevisionRecord,
  DailyReportSubmissionStatus
} from './dailyReportTypes';
import {
  BUILT_IN_TEMPLATES,
  DailyReportPayloadInput,
  DailyReportTemplateKey,
  EMPTY_PAYLOAD,
  TemplateDefinition,
  computeDerivedValues,
  carryCompletions,
  isEntryOverdue,
  validateReportPayload
} from './dailyReportTemplates';
import { DeadlinePolicy, isIsoDate, isLateSubmission, istDate, missingIsVisibleYet, scheduleFor } from './dailyReportTime';
import { resolveTemplateForDepartment, resolveTemplateForStoredReport } from './dailyReportTemplateStore';
import { getDeadlinePolicy } from './dailyReportConfigStore';
import { consumeEditGrant } from './dailyReportEditRequestStore';
import { computeSalesAutoMatrix, mergeAutoMatrix } from './salesDailyAutoFetch';
import { computeGemProposalEntries, mergeAutoGemEntries } from './gemProposalAutoFetch';
import { refreshTmsLinkedEntries, createPendingTmsTasksFromEntries } from './aiTmsTaskLink';

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
 * The derived columns (Task ID, Days Left, overdue) are computed here on every
 * read rather than stored. Days-left is measured from today, so recomputing is
 * what makes it true at all — a stored value would be wrong by one the next
 * morning — and it guarantees the number the employee sees is the same one
 * that decides whether the row reads as overdue.
 */
function toRecord(row: Model, template: TemplateDefinition): DailyReportRecord {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const reportDate = dateOnly(plain.report_date);
  // Days-left and overdue are relative to now rather than to the reporting
  // date, so the clock is read here — at the edge — and the arithmetic itself
  // stays a pure function of it.
  const today = istDate(new Date());
  const rawEntries = (Array.isArray(plain.entries) ? plain.entries : []) as { id: string; position: number; data: Record<string, unknown> }[];
  const sorted = [...rawEntries].sort((a, b) => a.position - b.position);

  const entries: DailyReportEntryRecord[] = sorted.map((entry, index) => ({
    id: entry.id,
    position: entry.position,
    data: entry.data ?? {},
    derived: computeDerivedValues(template, reportDate, entry.data ?? {}, index, today),
    overdue: isEntryOverdue(template, reportDate, entry.data ?? {}, index, today)
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
    payload: (plain.payload as Record<string, unknown>) ?? {},
    header_derived: computeDerivedValues(template, reportDate, (plain.payload as Record<string, unknown>) ?? {}, 0, today),
    matrix: (plain.matrix as Record<string, Record<string, number>>) ?? {},
    entries,
    submitted_at: isoOrEmpty(plain.submitted_at),
    is_late: Boolean(plain.is_late),
    deadline_at: isoOrEmpty(plain.deadline_at),
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
  /** Null only for the scheduler's own auto-submit — see `auto` below. */
  actorId: string | null;
  /** True when a manager is filing for someone else — recorded, not implied. */
  onBehalf: boolean;
  /**
   * True only for the scheduler's Sales/GEM-Sales auto-submit
   * (lib/dailyReportStore.ts's autoSubmitReport, called from
   * lib/dailyReportScheduler.ts). Nobody "acted" — actorId is null and
   * onBehalf is false — but a human must still never get a silent pass on
   * the all-zero-grid rule, so this flag is what lets a genuinely empty day
   * explain itself automatically instead of bypassing the rule.
   */
  auto?: boolean;
  /**
   * Why this writer may change an already-filed report. Absent means they may
   * not: submitting is terminal, and ANY write over a SUBMITTED report is
   * refused by the guard in the update branch.
   *
   *   'approver' — a department manager of this employee, or an admin. They
   *                are the authority the lock defers to, so there is nothing
   *                to spend; making them request permission from themselves
   *                would be circular.
   *   'grant'    — the employee, holding an approved request. The grant is
   *                spent inside THIS function's transaction rather than by
   *                the caller, so a save that then fails validation does not
   *                burn their one permission.
   */
  editAuthority?: 'approver' | 'grant';
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
  /**
   * True when this save CHANGED a report that was already submitted.
   *
   * Managers are deliberately NOT mailed for an edit — most edits are typo
   * fixes, and mailing every save would train a manager to ignore the mail
   * that matters. It is audited instead, because a retroactive change to a
   * submitted report is exactly the kind of thing someone later needs to be
   * able to ask about, and before this the only trace was a revision row no
   * screen displayed.
   */
  wasEdited: boolean;
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

/**
 * The entry data a report currently holds, in display order.
 *
 * Read inside the caller's transaction and BEFORE replaceEntries destroys
 * it — carryCompletions needs the outgoing generation to know which rows
 * were already finished, and this is the last moment it exists.
 */
async function loadEntryData(reportId: string, t: Transaction): Promise<Record<string, unknown>[]> {
  const rows = await db.DailyReportEntry.findAll({
    where: { report_id: reportId } as never,
    order: [['position', 'ASC']],
    transaction: t
  });
  return rows.map((row) => (row.get({ plain: true }) as { data: Record<string, unknown> | null }).data ?? {});
}

async function replaceEntries(reportId: string, entries: Record<string, unknown>[], t: Transaction): Promise<void> {
  // Replace-all rather than diff-and-patch. The client owns the row order
  // (add/remove/reorder are all one edit to it), so reconciling by id would
  // be more code for an identical result — and a hard-deleted previous
  // generation is fine because the content of every revision is preserved in
  // daily_report_revisions, completion stamps included: saveReport resolves
  // those before it takes the snapshot, precisely so this delete cannot be
  // the one thing that loses them.
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

  // Sales/GEM-Sales' 4 auto measures are never trusted from the client —
  // recomputed and overlaid here regardless of what payload.matrix carried,
  // on every save AND every submit, so there is no window where a client
  // could post a fabricated number for one of them. The other 4 measures
  // (whatever's manual for this template, usually everything) pass through
  // untouched. See lib/salesDailyAutoFetch.ts.
  if (resolved.template.layout === 'matrix' && resolved.template.autoMeasures?.length) {
    const auto = await computeSalesAutoMatrix(input.employeeId, input.reportDate, resolved.template.autoMeasures, resolved.template.channels ?? []);
    payload = { ...payload, matrix: mergeAutoMatrix(payload.matrix as Record<string, Record<string, number>>, auto) };
  }

  // GEM Sales' Proposal Creation rows — same reasoning as the Sales matrix
  // overlay above, just for a rows-layout template: never trusted from the
  // client, recomputed from the day's own Quotation activity and merged in
  // on every save and submit. See lib/gemProposalAutoFetch.ts.
  if (resolved.template.layout === 'rows' && resolved.template.autoEntryActivity) {
    const employeeRow = await db.User.findByPk(input.employeeId, { attributes: ['name', 'username'] });
    const employeeName = (employeeRow?.get('name') as string) || (employeeRow?.get('username') as string) || '';
    const autoEntries = await computeGemProposalEntries(input.employeeId, employeeName, input.reportDate);
    payload = { ...payload, entries: mergeAutoGemEntries(payload.entries ?? [], autoEntries) };
  }

  // The system's own auto-submit is the one caller allowed to hit a
  // genuinely all-zero grid — that is exactly the day the 2-zero-day warning
  // (lib/dailyReportSweepPlan.ts's planZeroTotalWarnings) needs to see land
  // as SUBMITTED, not rejected. Rather than weakening the all-zero rule
  // below for everyone, an auto-submit with nothing in it explains itself
  // the same way a human is asked to: by filling in the one escape hatch the
  // rule already has. A human-entered note, or any non-zero cell, is left
  // exactly as given.
  if (input.auto && input.mode === 'submit') {
    const header = (payload.header ?? {}) as Record<string, unknown>;
    const hasNote = typeof header.notes === 'string' && header.notes.trim().length > 0;
    const matrixValues = Object.values(payload.matrix ?? {}).flatMap((row) => Object.values(row ?? {}));
    const allZero = matrixValues.every((value) => !Number(value));
    if (allZero && !hasNote) {
      payload = { ...payload, header: { ...header, notes: 'Auto-submitted by the system — no activity recorded for the day.' } };
    }
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
  let wasEdited = false;

  const reportId = await db.sequelize.transaction(async (t) => {
    // Completion stamps are resolved HERE, ahead of the snapshot, for two
    // reasons: the revision row then records exactly the rows that get
    // written (completed_on is the one entry value the client never sends,
    // so a snapshot taken from the validator output would be the only
    // place it was missing), and carryCompletions needs the outgoing
    // generation, which replaceEntries is about to destroy.
    let stampedEntries = carryCompletions(
      validation.normalized.entries,
      existing ? await loadEntryData(existing.get('id') as string, t) : [],
      input.reportDate,
      istDate(new Date())
    );
    // A linked AI row's TMS-sourced fields (description, due date, status,
    // progress...) have the final say over whatever carryCompletions just
    // guessed from content-matching — see lib/aiTmsTaskLink.ts's own
    // comment on why this runs after it, not before.
    if (resolved.template.layout === 'rows' && resolved.template.supportsTmsTaskLink) {
      stampedEntries = await refreshTmsLinkedEntries(stampedEntries, input.employeeId);
      // Pending project selections (components/DailyReportForm.tsx's "Create
      // TMS Task In Project" dropdown) only resolve into a real TMS task on
      // a genuine human SUBMIT, never a draft save (a draft is documented
      // elsewhere in this app as private and not yet real) and never the
      // system's own unattended auto-submit (input.actorId is null there —
      // minting a new tracked, attributed TMS task with no human behind it
      // to credit is left for the employee to do themselves later).
      if (input.mode === 'submit' && input.actorId) {
        stampedEntries = await createPendingTmsTasksFromEntries(stampedEntries, input.employeeId, input.actorId);
      }
    }
    const snapshot = { payload: validation.normalized.header, matrix: validation.normalized.matrix, entries: stampedEntries };

    if (!existing) {
      const attrs: Record<string, unknown> = {
        employee_id: input.employeeId,
        department_id: input.departmentId,
        report_date: input.reportDate,
        template_key: resolved.templateKey,
        submission_status: input.mode === 'submit' ? submittedStatus : 'DRAFT',
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
      await replaceEntries(id, stampedEntries, t);
      await recordRevision(
        id,
        input.actorId,
        input.auto ? 'auto_submitted' : input.onBehalf ? 'filed_for_employee' : input.mode === 'submit' ? 'submitted' : 'created',
        attrs.submission_status as string,
        snapshot,
        '',
        t
      );
      return id;
    }

    const id = existing.get('id') as string;
    const wasSubmitted = SUBMITTED_STATUSES.includes(existing.get('submission_status') as DailyReportSubmissionStatus);

    // The system's own auto-submit racing a real human submission: the
    // employee (or their manager) got there first, between the scheduler's
    // planning read and this write. A true no-op — touching the row here
    // would null out updated_by (actorId is null for auto-submit) and log a
    // spurious 'edited' revision for content nobody actually edited.
    // processAutoSubmit's caller distinguishes this from a fresh auto-submit
    // via justSubmitted, which recomputing matrix/overlay doesn't change.
    if (input.auto && wasSubmitted) {
      return id;
    }

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

    // ANY write over an already-submitted report is a retroactive edit,
    // whichever mode it arrived as — classified here rather than in the
    // submit branch above, and deliberately alongside the 'edited' revision
    // label below so the two can never disagree. A mode:'draft' POST over a
    // submitted report replaces the filed content just as thoroughly as a
    // re-submit does, and that was the one path where the manager's
    // "Changed since" badge appeared while the audit log said nothing.
    wasEdited = !justSubmitted && wasSubmitted;

    // Submitting is terminal.
    //
    // This is deliberately HERE rather than in the routes. Five different
    // write paths reach this function — the employee's own save, the
    // employee's submit, a manager's PATCH, /submit, and file-for-employee —
    // and gating any one of them leaves the other four open. Everything that
    // can rewrite a filed report passes through this line.
    //
    // The scheduler's auto-submit is exempt by construction: it returned
    // above when wasSubmitted, so it never reaches here.
    if (wasEdited) {
      if (!input.editAuthority) {
        throw new DailyReportValidationError(
          'This report has already been filed and can no longer be changed. Ask your department manager for permission to edit it.'
        );
      }
      // Only an employee's grant is spent. An approver has none to spend —
      // consuming here would refuse the very people the lock defers to.
      if (input.editAuthority === 'grant') {
        const spent = await consumeEditGrant(id, t);
        if (!spent) {
          throw new DailyReportValidationError(
            'That permission to edit has already been used or has expired. Ask your department manager again.'
          );
        }
      }
    }

    await existing.update(attrs as never, { transaction: t });
    await replaceEntries(id, stampedEntries, t);
    await recordRevision(
      id,
      input.actorId,
      justSubmitted ? (input.auto ? 'auto_submitted' : input.onBehalf ? 'filed_for_employee' : 'submitted') : wasSubmitted ? 'edited' : 'draft_saved',
      (attrs.submission_status as string) ?? (existing.get('submission_status') as string),
      snapshot,
      '',
      t
    );
    return id;
  });

  return { report: await hydrate(reportId), justSubmitted, wasEdited };
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

/**
 * The scheduler's Sales/GEM-Sales auto-submit — called from
 * lib/dailyReportScheduler.ts once planAutoSubmits says one is due.
 *
 * Unlike submitReportById, there may be no existing row at all: an employee
 * who never opened the Daily Report page that day has no draft to submit
 * from, and saveReport's own create branch already does the right thing —
 * EMPTY_PAYLOAD plus the auto-measures overlay is exactly "they entered
 * nothing manually, here is what really happened that day."
 */
export async function autoSubmitReport(employeeId: string, departmentId: string, reportDate: string): Promise<SaveReportResult> {
  return saveReport({ employeeId, departmentId, reportDate, mode: 'submit', actorId: null, onBehalf: false, auto: true });
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
): Promise<Map<string, { id: string; submission_status: DailyReportSubmissionStatus; submitted_at: string; is_late: boolean; filed_by_name: string; entry_count: number }>> {
  const map = new Map<string, { id: string; submission_status: DailyReportSubmissionStatus; submitted_at: string; is_late: boolean; filed_by_name: string; entry_count: number }>();
  if (!employeeIds.length) return map;

  const rows = await db.DailyReport.findAll({
    where: { employee_id: employeeIds, report_date: { [Op.between]: [from, to] } } as never,
    attributes: ['id', 'employee_id', 'report_date', 'submission_status', 'submitted_at', 'is_late'],
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

/**
 * subjectKey -> the sum of a SUBMITTED report's auto-fetched measure cells
 * only (lib/salesDailyAutoFetch.ts's 4 Sales/GEM-Sales measures) — never the
 * other, manually-typed measures on the same report. This is what
 * lib/dailyReportSweepPlan.ts's planZeroTotalWarnings tracks: whether the
 * auto fetch itself found anything, not whether the employee typed anything.
 *
 * Reads the already-stored `matrix` rather than recomputing from
 * Lead/Quotation — saveReport overlays fresh auto values on every save and
 * submit (see computeSalesAutoMatrix), so a submitted report's stored value
 * for an auto measure key already IS the auto-fetched one.
 *
 * A row whose template has no autoMeasures contributes nothing — harmless,
 * since the caller is expected to have already narrowed `employeeIds` to
 * auto-measures employees, but correct either way.
 */
export async function loadAutoTotalsByKey(employeeIds: string[], from: string, to: string): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!employeeIds.length) return map;
  const rows = await db.DailyReport.findAll({
    where: { employee_id: employeeIds, report_date: { [Op.between]: [from, to] }, submission_status: SUBMITTED_STATUSES } as never,
    attributes: ['employee_id', 'report_date', 'template_key', 'matrix']
  });
  for (const row of rows) {
    const plain = row.get({ plain: true }) as Record<string, unknown>;
    const autoMeasures = BUILT_IN_TEMPLATES[plain.template_key as DailyReportTemplateKey]?.autoMeasures;
    if (!autoMeasures?.length) continue;
    const matrix = (plain.matrix as Record<string, Record<string, unknown>>) ?? {};
    let total = 0;
    for (const measure of autoMeasures) {
      for (const value of Object.values(matrix[measure] ?? {})) total += Number(value) || 0;
    }
    map.set(lookupKey(plain.employee_id as string, dateOnly(plain.report_date)), total);
  }
  return map;
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
  const now = new Date();
  const statuses = await loadReportStatuses([employeeId], sorted[0], sorted[sorted.length - 1]);
  return [...sorted].reverse().map((reportDate) => {
    const found = statuses.get(lookupKey(employeeId, reportDate));
    return {
      report_date: reportDate,
      // Same rule the team dashboard uses: today is not 'missing' until the
      // day has stopped being open. Applying it in only one of the two
      // places meant an employee's own page called them missing at 9am while
      // their manager's page did not.
      submission_status: found
        ? found.submission_status
        : missingIsVisibleYet(reportDate, now)
          ? 'MISSING'
          : 'PENDING',
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
