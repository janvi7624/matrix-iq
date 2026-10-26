import { Model, Op, Transaction } from 'sequelize';
import { db, isUuid } from './db';
import { DailyReportEditRequestRecord, DailyReportEditRequestStatus } from './dailyReportTypes';

// Permission to edit a report that has already been filed.
//
// Submitting is terminal. An employee who needs to change a filed report asks
// their DEPARTMENT MANAGER; an approval is a single-use grant that exactly one
// save spends, and it expires on its own if nobody uses it.
//
// Modelled on lib/dailyReportLeaveClaimStore.ts, the module's existing
// request->approve store, down to the error class, the INCLUDES array and the
// toRecord flattening. Two things are taken from lib/projectTechnicalRequest.ts
// instead: the conditional `UPDATE ... WHERE id AND status = ...` that makes a
// decision race-proof, and the same trick again to consume the grant, so two
// browser tabs cannot both spend one approval.
//
// NOT findOrCreate anywhere: the database role has no TEMP privilege, so
// Sequelize's findOrCreate fails at runtime. findOne + create + catch the
// unique violation is the house workaround.

export class DailyReportEditRequestError extends Error {}

/** How long an approval stays redeemable. */
export const EDIT_GRANT_HOURS = 24;

const LIVE_STATUSES: DailyReportEditRequestStatus[] = ['PENDING', 'APPROVED'];

const INCLUDES = [
  { model: db.User, as: 'employee', attributes: ['id', 'username', 'name'] },
  { model: db.Department, as: 'department', attributes: ['id', 'name'] },
  { model: db.User, as: 'decider', attributes: ['id', 'username', 'name'] }
];

function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

function dateOnly(value: unknown): string {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function personName(person: unknown): string {
  const p = person as { name?: string; username?: string } | null;
  return p?.name || p?.username || '';
}

function toRecord(row: Model): DailyReportEditRequestRecord {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  return {
    id: plain.id as string,
    report_id: plain.report_id as string,
    employee_id: plain.employee_id as string,
    employee_name: personName(plain.employee),
    department_name: (plain.department as { name?: string } | null)?.name ?? '',
    report_date: dateOnly(plain.report_date),
    reason: (plain.reason as string) ?? '',
    status: plain.status as DailyReportEditRequestStatus,
    decided_by_name: personName(plain.decider),
    decided_at: isoOrEmpty(plain.decided_at),
    decision_reason: (plain.decision_reason as string) ?? '',
    grant_expires_at: isoOrEmpty(plain.grant_expires_at),
    used_at: isoOrEmpty(plain.used_at),
    created_at: isoOrEmpty(plain.createdAt ?? plain.created_at)
  };
}

// ---------------------------------------------------------------------------
// Tolerating a table that is not there yet
//
// This feature ships as code plus a migration, and the two do not land at the
// same instant. A server that restarts before
// 20261026120000-create-daily-report-edit-requests.js has run would otherwise
// take the whole Daily Report page down with it, because buildMyDailyReport
// asks for the live request on every load.
//
// So a MISSING TABLE specifically is read as "nobody has asked to edit
// anything" — which is true, and which fails in the safe direction: no grant
// means no edit authority from a grant, means a filed report stays locked,
// which is the behaviour that was asked for anyway. Every other error still
// throws. Narrow on purpose: Postgres 42P01 is undefined_table and nothing
// else.
// ---------------------------------------------------------------------------

function isMissingTable(error: unknown): boolean {
  const e = error as { parent?: { code?: string }; original?: { code?: string } };
  return e?.parent?.code === '42P01' || e?.original?.code === '42P01';
}

/**
 * The model is absent entirely when the server booted before the model file
 * existed — lib/db.ts caches the registry on global.__nantaDb, so a new model
 * needs a restart before it is visible.
 */
function tableIsReady(): boolean {
  if (db.DailyReportEditRequest) return true;
  console.error(
    '[daily-report] The DailyReportEditRequest model is not registered — this server is running a model registry cached before the model file existed (lib/db.ts caches on global.__nantaDb). Restart the server. Until then, filed reports stay locked and nobody can ask to edit one.'
  );
  return false;
}

function rethrowUnlessMissingTable(error: unknown): null {
  if (isMissingTable(error)) {
    console.error(
      '[daily-report] daily_report_edit_requests does not exist yet — run the pending migration. Filed reports stay locked until then.'
    );
    return null;
  }
  throw error;
}

export interface CreateEditRequestInput {
  reportId: string;
  employeeId: string;
  departmentId: string | null;
  reportDate: string;
  reason: string;
}

export async function createEditRequest(input: CreateEditRequestInput): Promise<DailyReportEditRequestRecord> {
  const reason = (input.reason ?? '').trim();
  if (!reason) {
    throw new DailyReportEditRequestError('Say what needs correcting — your manager decides on the reason.');
  }
  if (reason.length > 2000) {
    throw new DailyReportEditRequestError('Keep the reason under 2000 characters.');
  }
  // A readable sentence rather than a raw SQL error, for the window between
  // the code deploying and the migration running.
  if (!tableIsReady()) {
    throw new DailyReportEditRequestError(
      'Asking to edit a filed report is not available yet on this deployment. Tell an administrator the Daily Report edit-permission migration still needs to run.'
    );
  }

  // A pre-check purely so the message reads like a sentence. The partial
  // unique index below is what actually guarantees one live request.
  const live = await findLiveEditRequest(input.reportId);
  if (live) {
    throw new DailyReportEditRequestError(
      live.status === 'PENDING'
        ? 'You have already asked to edit this report — your manager has not decided yet.'
        : 'Permission to edit this report has already been granted.'
    );
  }

  try {
    const row = await db.DailyReportEditRequest.create({
      report_id: input.reportId,
      employee_id: input.employeeId,
      department_id: input.departmentId,
      report_date: input.reportDate,
      reason,
      status: 'PENDING'
    } as never);
    return (await findEditRequestById(row.get('id') as string))!;
  } catch (error) {
    if ((error as { name?: string }).name === 'SequelizeUniqueConstraintError') {
      throw new DailyReportEditRequestError('There is already a live request to edit this report.');
    }
    throw error;
  }
}

export async function findEditRequestById(id: string): Promise<DailyReportEditRequestRecord | undefined> {
  if (!isUuid(id)) return undefined;
  const row = await db.DailyReportEditRequest.findByPk(id, { include: INCLUDES as never });
  return row ? toRecord(row) : undefined;
}

/**
 * The one live request for a report, if any — PENDING or an APPROVED grant
 * that has not been spent.
 *
 * An approval past its expiry is reported as EXPIRED rather than APPROVED, so
 * callers never show a grant that can no longer be redeemed. The row is left
 * alone; consumeEditGrant is the only thing that writes a terminal state, and
 * it applies the same clock.
 */
export async function findLiveEditRequest(reportId: string): Promise<DailyReportEditRequestRecord | undefined> {
  if (!isUuid(reportId)) return undefined;
  if (!tableIsReady()) return undefined;
  const row = await db.DailyReportEditRequest.findOne({
    where: { report_id: reportId, status: { [Op.in]: LIVE_STATUSES } } as never,
    include: INCLUDES as never,
    order: [['created_at', 'DESC']]
  }).catch(rethrowUnlessMissingTable);
  if (!row) return undefined;
  const record = toRecord(row);
  if (record.status === 'APPROVED' && isExpired(record.grant_expires_at)) {
    return { ...record, status: 'EXPIRED' };
  }
  return record;
}

function isExpired(grantExpiresAt: string, now: Date = new Date()): boolean {
  if (!grantExpiresAt) return false;
  const at = new Date(grantExpiresAt);
  return Number.isFinite(at.getTime()) && at.getTime() <= now.getTime();
}

export interface ListEditRequestFilters {
  /** Restrict to these departments — a manager's own, never the whole company. */
  departmentIds?: string[];
  status?: DailyReportEditRequestStatus;
  employeeId?: string;
}

export async function listEditRequests(filters: ListEditRequestFilters = {}): Promise<DailyReportEditRequestRecord[]> {
  if (!tableIsReady()) return [];
  const where: Record<string, unknown> = {};
  if (filters.status) where.status = filters.status;
  if (filters.employeeId) where.employee_id = filters.employeeId;
  if (filters.departmentIds) where.department_id = { [Op.in]: filters.departmentIds };

  const rows = (await db.DailyReportEditRequest.findAll({
    where: where as never,
    include: INCLUDES as never,
    // PENDING first — a manager's queue is a to-do list, not a log.
    order: [
      [db.Sequelize.literal("CASE WHEN \"DailyReportEditRequest\".\"status\" = 'PENDING' THEN 0 ELSE 1 END"), 'ASC'],
      ['report_date', 'DESC']
    ]
  }).catch((e: unknown) => { rethrowUnlessMissingTable(e); return []; })) as Model[];
  return rows.map(toRecord);
}

/**
 * Approve or refuse, and never twice.
 *
 * The status flip is a conditional UPDATE rather than a read-then-write: two
 * managers pressing Approve at the same moment cannot both win, and the loser
 * gets a sentence rather than silently overwriting the winner's decision.
 */
export async function decideEditRequest(
  id: string,
  decision: 'APPROVED' | 'REJECTED',
  deciderId: string,
  decisionReason: string
): Promise<DailyReportEditRequestRecord> {
  const reason = (decisionReason ?? '').trim();
  // Both outcomes need a reason: a decision somebody may later be asked to
  // justify should not be recordable without one.
  if (!reason) {
    throw new DailyReportEditRequestError(
      decision === 'APPROVED'
        ? 'Say what you are allowing to be changed.'
        : 'Say why this edit is not being allowed — the employee sees this.'
    );
  }

  const grantExpiresAt = decision === 'APPROVED' ? new Date(Date.now() + EDIT_GRANT_HOURS * 3600_000) : null;
  const [count] = await db.DailyReportEditRequest.update(
    {
      status: decision,
      decided_by: deciderId,
      decided_at: new Date(),
      decision_reason: reason,
      grant_expires_at: grantExpiresAt
    } as never,
    { where: { id, status: 'PENDING' } as never }
  );
  if (!count) {
    throw new DailyReportEditRequestError('This request has already been decided.');
  }
  return (await findEditRequestById(id))!;
}

/** Withdraw one's own request, before it is decided. */
export async function withdrawEditRequest(id: string, employeeId: string): Promise<boolean> {
  const [count] = await db.DailyReportEditRequest.update(
    { status: 'REJECTED', decided_at: new Date(), decision_reason: 'Withdrawn by the employee.' } as never,
    { where: { id, employee_id: employeeId, status: 'PENDING' } as never }
  );
  return count > 0;
}

/**
 * Spend an approval, inside the caller's transaction.
 *
 * Single-use and race-proof for the same reason decideEditRequest is: the
 * UPDATE itself carries the condition, so the grant cannot be redeemed twice
 * by two tabs saving at once. Returns false when there is nothing to spend —
 * no grant, already spent, or expired — and the caller must then refuse the
 * write rather than carrying on.
 *
 * The expiry is applied here as well as in findLiveEditRequest, because this
 * is the one that actually permits a write.
 */
export async function consumeEditGrant(reportId: string, transaction?: Transaction): Promise<boolean> {
  if (!isUuid(reportId)) return false;
  if (!tableIsReady()) return false;
  const now = new Date();
  const [count] = await db.DailyReportEditRequest.update(
    { status: 'USED', used_at: now } as never,
    {
      where: {
        report_id: reportId,
        status: 'APPROVED',
        [Op.or]: [{ grant_expires_at: null }, { grant_expires_at: { [Op.gt]: now } }]
      } as never,
      transaction
    }
  );
  return count > 0;
}
