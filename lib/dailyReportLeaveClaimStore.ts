import { Model, Op } from 'sequelize';
import { db, isUuid } from './db';
import { DailyReportLeaveClaimRecord, DailyReportLeaveClaimStatus } from './dailyReportTypes';
import { isIsoDate, monthKey } from './dailyReportTime';

// "I was on leave on this reporting date."
//
// Deliberately a separate table from the existing leave_requests (HR leave
// applications, lib/leaveRequestStore.ts): that one is a forward-looking
// application for a date RANGE with a leave type and its own approval
// routing, while this is a retrospective exemption for a SINGLE reporting
// date whose only job is to excuse a missing report. Overloading
// leave_requests would have meant giving its status machine two meanings and
// its approvals two audiences.
//
// The duplicate rule is a partial unique index (see the migration) that
// covers PENDING and APPROVED only — so one live claim per date, but a
// rejected claim doesn't permanently bar re-raising the date with better
// evidence.

export class DailyReportLeaveClaimError extends Error {}

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
  { model: db.User, as: 'reviewer', attributes: ['id', 'username', 'name'] }
];

function toRecord(row: Model): DailyReportLeaveClaimRecord {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const employee = plain.employee as { name?: string; username?: string } | null;
  const reviewer = plain.reviewer as { name?: string; username?: string } | null;
  return {
    id: plain.id as string,
    employee_id: plain.employee_id as string,
    employee_name: employee?.name ?? employee?.username ?? '',
    department_name: (plain.department as { name?: string } | null)?.name ?? '',
    report_date: dateOnly(plain.report_date),
    reason: (plain.reason as string) ?? '',
    attachments: Array.isArray(plain.attachments) ? (plain.attachments as DailyReportLeaveClaimRecord['attachments']) : [],
    status: plain.status as DailyReportLeaveClaimStatus,
    reviewed_by_name: reviewer?.name ?? reviewer?.username ?? '',
    reviewed_at: isoOrEmpty(plain.reviewed_at),
    decision_reason: (plain.decision_reason as string) ?? '',
    created_at: isoOrEmpty(plain.createdAt)
  };
}

/** Statuses that actually excuse a date. PENDING counts — see createClaim. */
export const LIVE_CLAIM_STATUSES: DailyReportLeaveClaimStatus[] = ['PENDING', 'APPROVED'];

export interface CreateClaimInput {
  employeeId: string;
  departmentId: string | null;
  reportDate: string;
  reason: string;
  attachments?: { name: string; path: string; size?: number }[];
}

export async function createClaim(input: CreateClaimInput): Promise<DailyReportLeaveClaimRecord> {
  if (!isIsoDate(input.reportDate)) throw new DailyReportLeaveClaimError('A valid reporting date is required.');
  const reason = (input.reason || '').trim();
  if (!reason) throw new DailyReportLeaveClaimError('Give a reason for the leave claim.');
  if (reason.length > 2000) throw new DailyReportLeaveClaimError('Keep the reason under 2000 characters.');

  const todayIst = dateOnly(new Date(Date.now() + 330 * 60_000));
  if (input.reportDate > todayIst) throw new DailyReportLeaveClaimError('A leave claim can only cover today or an earlier date.');

  // Checked before the insert purely to produce a readable message; the
  // partial unique index is what actually prevents the duplicate under a
  // race, and the catch below turns that into the same sentence.
  const live = await db.DailyReportLeaveClaim.findOne({
    where: { employee_id: input.employeeId, report_date: input.reportDate, status: LIVE_CLAIM_STATUSES } as never
  });
  if (live) {
    const status = live.get('status') as DailyReportLeaveClaimStatus;
    throw new DailyReportLeaveClaimError(
      status === 'PENDING' ? 'You already have a leave claim awaiting HR for this date.' : 'This date is already covered by an approved leave claim.'
    );
  }

  try {
    const row = await db.DailyReportLeaveClaim.create({
      employee_id: input.employeeId,
      department_id: input.departmentId,
      report_date: input.reportDate,
      reason,
      attachments: input.attachments ?? [],
      status: 'PENDING'
    } as never);
    return (await findClaimById(row.get('id') as string)) as DailyReportLeaveClaimRecord;
  } catch (error) {
    if ((error as { name?: string }).name === 'SequelizeUniqueConstraintError') {
      throw new DailyReportLeaveClaimError('A leave claim for this date already exists.');
    }
    throw error;
  }
}

export interface MarkLeaveByManagerInput {
  employeeId: string;
  departmentId: string | null;
  reportDate: string;
  reason: string;
  /** The manager doing the marking — recorded as the claim's reviewer. */
  markedById: string;
}

export interface MarkLeaveByManagerResult {
  claim: DailyReportLeaveClaimRecord;
  /** Set when the marking waived a warning that had already been recorded. */
  waivedWarningId: string | null;
}

/**
 * The department manager marks a team member as on leave for one reporting
 * date, taking the decision themselves.
 *
 * Written as an APPROVED claim rather than a PENDING one: the manager is the
 * approver here, so there is nothing for HR to decide, and a PENDING row
 * would sit in HR's to-do list forever. Recording the manager in
 * reviewed_by/reviewed_at is what keeps "who excused this date" answerable —
 * the same columns HR's own decision writes, so history reads uniformly
 * whichever route excused a date.
 *
 * Waives an ACTIVE warning for that date, exactly as decideClaim's approval
 * branch does: if the sweep already ran before the manager got to it, the
 * date is still legitimately not worked and the warning must stop counting
 * toward the HR threshold. The row becomes 'WAIVED' rather than being
 * deleted, so the history still shows that a warning was raised and why it
 * was dropped.
 */
export async function markLeaveByManager(input: MarkLeaveByManagerInput): Promise<MarkLeaveByManagerResult> {
  if (!isIsoDate(input.reportDate)) throw new DailyReportLeaveClaimError('A valid reporting date is required.');
  const reason = (input.reason || '').trim();
  if (!reason) throw new DailyReportLeaveClaimError('Give a reason for marking this leave.');
  if (reason.length > 2000) throw new DailyReportLeaveClaimError('Keep the reason under 2000 characters.');

  // Readable message for the common case; the partial unique index is what
  // actually holds under a race, and the catch below says the same thing.
  const live = await db.DailyReportLeaveClaim.findOne({
    where: { employee_id: input.employeeId, report_date: input.reportDate, status: LIVE_CLAIM_STATUSES } as never
  });
  if (live) {
    const status = live.get('status') as DailyReportLeaveClaimStatus;
    throw new DailyReportLeaveClaimError(
      status === 'PENDING'
        ? 'This person already has a leave claim awaiting HR for this date — decide that instead.'
        : 'This date is already covered by approved leave.'
    );
  }

  let claimId = '';
  let waivedWarningId: string | null = null;

  try {
    await db.sequelize.transaction(async (t) => {
      const row = await db.DailyReportLeaveClaim.create(
        {
          employee_id: input.employeeId,
          department_id: input.departmentId,
          report_date: input.reportDate,
          reason,
          attachments: [],
          status: 'APPROVED',
          reviewed_by: input.markedById,
          reviewed_at: new Date(),
          decision_reason: 'Marked as leave by the department manager.'
        } as never,
        { transaction: t }
      );
      claimId = row.get('id') as string;

      const warning = await db.DailyReportWarning.findOne({
        where: { employee_id: input.employeeId, report_date: input.reportDate } as never,
        transaction: t
      });
      if (warning && warning.get('status') === 'ACTIVE') {
        await warning.update(
          {
            status: 'WAIVED',
            waived_by: input.markedById,
            waived_at: new Date(),
            waiver_reason: `Leave marked by department manager: ${reason}`
          } as never,
          { transaction: t }
        );
        waivedWarningId = warning.get('id') as string;
      }
    });
  } catch (error) {
    if ((error as { name?: string }).name === 'SequelizeUniqueConstraintError') {
      throw new DailyReportLeaveClaimError('A leave claim for this date already exists.');
    }
    throw error;
  }

  return { claim: (await findClaimById(claimId)) as DailyReportLeaveClaimRecord, waivedWarningId };
}

export async function findClaimById(id: string): Promise<DailyReportLeaveClaimRecord | null> {
  if (!isUuid(id)) return null;
  const row = await db.DailyReportLeaveClaim.findByPk(id, { include: INCLUDES as never });
  return row ? toRecord(row) : null;
}

/** The live claim for one employee and date, if there is one. */
export async function findLiveClaim(employeeId: string, reportDate: string): Promise<DailyReportLeaveClaimRecord | null> {
  if (!isUuid(employeeId) || !isIsoDate(reportDate)) return null;
  const row = await db.DailyReportLeaveClaim.findOne({
    where: { employee_id: employeeId, report_date: reportDate, status: LIVE_CLAIM_STATUSES } as never,
    include: INCLUDES as never
  });
  return row ? toRecord(row) : null;
}

/** Every claim for one employee and date, newest first — including rejected. */
export async function listClaimsForDate(employeeId: string, reportDate: string): Promise<DailyReportLeaveClaimRecord[]> {
  if (!isUuid(employeeId) || !isIsoDate(reportDate)) return [];
  const rows = await db.DailyReportLeaveClaim.findAll({
    where: { employee_id: employeeId, report_date: reportDate } as never,
    include: INCLUDES as never,
    order: [['createdAt', 'DESC']]
  });
  return rows.map(toRecord);
}

export interface ClaimFilters {
  employeeIds?: string[];
  departmentIds?: string[];
  status?: DailyReportLeaveClaimStatus;
  from?: string;
  to?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

const MAX_PAGE_SIZE = 200;

export async function listClaims(filters: ClaimFilters = {}): Promise<{ claims: DailyReportLeaveClaimRecord[]; total: number; page: number; pageSize: number }> {
  const where: Record<string | symbol, unknown> = {};
  if (filters.employeeIds) where.employee_id = filters.employeeIds;
  if (filters.departmentIds?.length) where.department_id = filters.departmentIds;
  if (filters.status) where.status = filters.status;
  if (filters.from && filters.to) where.report_date = { [Op.between]: [filters.from, filters.to] };
  else if (filters.from) where.report_date = { [Op.gte]: filters.from };
  else if (filters.to) where.report_date = { [Op.lte]: filters.to };

  const search = (filters.search ?? '').trim();
  const include = search
    ? [
        { ...INCLUDES[0], where: { [Op.or]: [{ name: { [Op.iLike]: `%${search}%` } }, { username: { [Op.iLike]: `%${search}%` } }] }, required: true },
        INCLUDES[1],
        INCLUDES[2]
      ]
    : INCLUDES;

  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, filters.pageSize ?? 50));

  const { count, rows } = await db.DailyReportLeaveClaim.findAndCountAll({
    where: where as never,
    include: include as never,
    // PENDING first — an HR queue is a to-do list, not a log.
    order: [
      [db.Sequelize.literal("CASE WHEN \"DailyReportLeaveClaim\".\"status\" = 'PENDING' THEN 0 ELSE 1 END"), 'ASC'],
      ['report_date', 'DESC']
    ] as never,
    limit: pageSize,
    offset: (page - 1) * pageSize,
    // The employee include with a `where` turns this into a join that would
    // otherwise multiply the count by the number of matched rows.
    distinct: true
  });

  return { claims: rows.map(toRecord), total: count, page, pageSize };
}

/**
 * Keys ('employeeId|date') for every date currently excused.
 *
 * PENDING is included on purpose: the workflow says a pending claim
 * temporarily excludes the date from NEW reminders and warnings, so nobody
 * is nagged while HR is still deciding. If HR later rejects it, the
 * configured rejection policy decides what happens — see decideClaim.
 */
export async function loadLeaveCoveredKeys(employeeIds: string[], from: string, to: string): Promise<Set<string>> {
  if (!employeeIds.length) return new Set();
  const rows = await db.DailyReportLeaveClaim.findAll({
    where: { employee_id: employeeIds, report_date: { [Op.between]: [from, to] }, status: LIVE_CLAIM_STATUSES } as never,
    attributes: ['employee_id', 'report_date', 'status']
  });
  return new Set(rows.map((r) => `${r.get('employee_id') as string}|${dateOnly(r.get('report_date'))}`));
}

export async function countClaimsByStatus(employeeIds: string[], from: string, to: string): Promise<{ employeeId: string; status: DailyReportLeaveClaimStatus; count: number }[]> {
  if (!employeeIds.length) return [];
  const rows = await db.DailyReportLeaveClaim.findAll({
    attributes: ['employee_id', 'status', [db.Sequelize.fn('COUNT', db.Sequelize.col('id')), 'count']],
    where: { employee_id: employeeIds, report_date: { [Op.between]: [from, to] } } as never,
    group: ['employee_id', 'status']
  });
  return rows.map((row) => ({
    employeeId: row.get('employee_id') as string,
    status: row.get('status') as DailyReportLeaveClaimStatus,
    count: Number(row.get('count')) || 0
  }));
}

export interface ClaimDecisionResult {
  claim: DailyReportLeaveClaimRecord;
  /** Set when approval waived a warning that had already been recorded. */
  waivedWarningId: string | null;
  /** What the configured policy did to the obligation on a rejection. */
  rejectionOutcome: 'reinstated' | 'waived' | null;
}

/**
 * HR's approve/reject, with the knock-on effect on the warning ledger.
 *
 * Approval waives any warning already recorded for that date — the date was
 * legitimately not worked, so a warning for it must not keep counting toward
 * the HR threshold. The warning row is NOT deleted (status becomes 'WAIVED'),
 * so the history still shows what happened and why.
 *
 * Rejection follows the configured policy instead of silently doing
 * something. 'reinstate' (the default) puts the date back in scope, so the
 * normal sweep records a warning for it if it is still unfiled AND still
 * inside the reconcile window — which is deliberately NOT the same as
 * backdating a warning for an arbitrarily old date. 'waive' records the
 * rejection but leaves the date excused, for an org that prefers the
 * conversation to the warning. Either way the decision, its author, its
 * timestamp and its reason are recorded, and the outcome is returned so the
 * caller can tell the employee exactly what happened.
 */
export async function decideClaim(
  id: string,
  decision: 'APPROVED' | 'REJECTED',
  reviewerId: string,
  reason: string,
  rejectionPolicy: 'reinstate' | 'waive'
): Promise<ClaimDecisionResult> {
  if (!isUuid(id)) throw new DailyReportLeaveClaimError('Leave claim not found.');
  const decisionReason = (reason || '').trim();
  if (!decisionReason) throw new DailyReportLeaveClaimError('Record a reason for this decision.');

  const row = await db.DailyReportLeaveClaim.findByPk(id);
  if (!row) throw new DailyReportLeaveClaimError('Leave claim not found.');
  if (row.get('status') !== 'PENDING') {
    throw new DailyReportLeaveClaimError(`This claim has already been ${String(row.get('status')).toLowerCase()}.`);
  }

  const employeeId = row.get('employee_id') as string;
  const reportDate = dateOnly(row.get('report_date'));
  let waivedWarningId: string | null = null;
  let rejectionOutcome: ClaimDecisionResult['rejectionOutcome'] = null;

  await db.sequelize.transaction(async (t) => {
    await row.update(
      { status: decision, reviewed_by: reviewerId, reviewed_at: new Date(), decision_reason: decisionReason } as never,
      { transaction: t }
    );

    const warning = await db.DailyReportWarning.findOne({
      where: { employee_id: employeeId, report_date: reportDate } as never,
      transaction: t
    });

    if (decision === 'APPROVED') {
      if (warning && warning.get('status') === 'ACTIVE') {
        await warning.update(
          {
            status: 'WAIVED',
            waived_by: reviewerId,
            waived_at: new Date(),
            waiver_reason: `Leave claim approved: ${decisionReason}`
          } as never,
          { transaction: t }
        );
        waivedWarningId = warning.get('id') as string;
      }
      return;
    }

    if (rejectionPolicy === 'waive') {
      rejectionOutcome = 'waived';
      // The obligation is let go, so an existing warning is waived too —
      // otherwise "we excused you" and "you have a warning" would both be
      // true, which is exactly the kind of contradiction this policy switch
      // exists to avoid.
      if (warning && warning.get('status') === 'ACTIVE') {
        await warning.update(
          { status: 'WAIVED', waived_by: reviewerId, waived_at: new Date(), waiver_reason: `Leave claim rejected, obligation waived: ${decisionReason}` } as never,
          { transaction: t }
        );
        waivedWarningId = warning.get('id') as string;
      }
      return;
    }

    rejectionOutcome = 'reinstated';
    // No warning is created here. The date simply stops being excused, and
    // the ordinary sweep decides — which keeps the "do not silently create
    // backdated warnings" rule intact: nothing is recorded for a date the
    // reconcile window no longer reaches.
    if (warning && warning.get('status') === 'WAIVED' && String(warning.get('waiver_reason') || '').startsWith('Leave claim')) {
      // A warning that a previous claim on this same date had waived becomes
      // active again, since the reason it was waived no longer holds.
      await warning.update(
        { status: 'ACTIVE', waived_by: null, waived_at: null, waiver_reason: null, source: 'leave_rejected' } as never,
        { transaction: t }
      );
    }
  });

  return { claim: (await findClaimById(id)) as DailyReportLeaveClaimRecord, waivedWarningId, rejectionOutcome };
}

/** Month -> claim status, for the employee's own history strip. */
export async function loadClaimStatusByDate(employeeId: string, from: string, to: string): Promise<Map<string, DailyReportLeaveClaimStatus>> {
  const map = new Map<string, DailyReportLeaveClaimStatus>();
  if (!isUuid(employeeId)) return map;
  const rows = await db.DailyReportLeaveClaim.findAll({
    where: { employee_id: employeeId, report_date: { [Op.between]: [from, to] } } as never,
    attributes: ['report_date', 'status'],
    order: [['createdAt', 'ASC']]
  });
  // Later rows win, so a re-raised claim after a rejection is what shows.
  for (const row of rows) map.set(dateOnly(row.get('report_date')), row.get('status') as DailyReportLeaveClaimStatus);
  return map;
}

/**
 * The same lookup for MANY employees over a range, keyed `employeeId|date`.
 *
 * The team matrix needs one query for the whole grid; calling
 * loadClaimStatusByDate per employee would be one round trip per row.
 * Key shape matches loadReportStatuses and loadWarningKeys so a cell can be
 * built from all three with one key.
 */
export async function loadClaimStatusKeys(
  employeeIds: string[],
  from: string,
  to: string
): Promise<Map<string, DailyReportLeaveClaimStatus>> {
  const map = new Map<string, DailyReportLeaveClaimStatus>();
  if (!employeeIds.length) return map;
  const rows = await db.DailyReportLeaveClaim.findAll({
    where: { employee_id: employeeIds, report_date: { [Op.between]: [from, to] } } as never,
    attributes: ['employee_id', 'report_date', 'status'],
    order: [['createdAt', 'ASC']]
  });
  // Later rows win, so a re-raised claim after a rejection is what shows.
  for (const row of rows) {
    map.set(
      `${row.get('employee_id') as string}|${dateOnly(row.get('report_date'))}`,
      row.get('status') as DailyReportLeaveClaimStatus
    );
  }
  return map;
}

export function claimMonthKey(reportDate: string): string {
  return monthKey(reportDate);
}
