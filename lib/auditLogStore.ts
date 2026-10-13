import { Model, Op } from 'sequelize';
import { AuditLogEntry, UserRole } from './types';
import { db } from './db';

function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

function toRecord(row: Model): AuditLogEntry {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  return {
    id: plain.id as string,
    at: isoOrEmpty(plain.at),
    by: (plain.by as string) ?? '',
    role: (plain.role as UserRole) ?? '',
    entity_type: plain.entity_type as AuditLogEntry['entity_type'],
    entity_id: (plain.entity_id as string) ?? '',
    action: (plain.action as string) ?? '',
    previous_status: (plain.previous_status as string) ?? '',
    new_status: (plain.new_status as string) ?? '',
    remarks: (plain.remarks as string) ?? '',
    ip: (plain.ip as string) ?? ''
  };
}

export interface LogAuditInput {
  by: string;
  role: UserRole;
  entityType: AuditLogEntry['entity_type'];
  entityId: string;
  action: string;
  previousStatus: string;
  newStatus: string;
  remarks?: string;
  ip?: string;
}

// audit_logs.action / previous_status / new_status are VARCHAR(255), and
// callers interpolate user data into them — "Lead assigned to rahul: <company>"
// where company is itself a 255-character column. Postgres rejects the whole
// INSERT on overflow, and since both writers below swallow errors to protect
// the workflow, an over-long company name silently lost the audit row. Worse
// for the batch writer: bulkCreate is ONE multi-row INSERT, so a single long
// value discarded all 600 rows of an expo assignment. A truncated line is a
// far better record than no line at all.
const FIELD_MAX = 255;
function fit(value: string): string {
  if (value.length <= FIELD_MAX) return value;
  return `${value.slice(0, FIELD_MAX - 1)}…`;
}

// Fire-and-forget style append used by every status-changing route in the
// Back Office workflow (demo approvals, DC lifecycle) — never throws, so a
// logging hiccup can't block the actual workflow action.
export async function logAudit(input: LogAuditInput): Promise<void> {
  try {
    const actor = await db.User.findOne({ where: { username: input.by } as never });
    await db.AuditLog.create({
      at: new Date(),
      by: input.by,
      actor_id: actor ? actor.get('id') : null,
      role: input.role,
      entity_type: input.entityType,
      entity_id: input.entityId || null,
      action: fit(input.action),
      previous_status: fit(input.previousStatus),
      new_status: fit(input.newStatus),
      remarks: input.remarks || '',
      ip: input.ip || ''
    } as never);
  } catch {
    // never let audit logging break the actual workflow action
  }
}

// Same thing for a batch — one actor lookup and one INSERT for the whole set
// instead of two queries per entry. Assigning an expo's 600 cards writes 600
// audit rows; doing that one at a time is 1,200 round trips and times the
// request out. Never throws, exactly like logAudit.
export async function logAuditMany(entries: LogAuditInput[]): Promise<void> {
  if (!entries.length) return;
  try {
    const actors = new Map<string, unknown>();
    for (const username of new Set(entries.map((e) => e.by).filter(Boolean))) {
      const actor = await db.User.findOne({ where: { username } as never, attributes: ['id'] });
      actors.set(username, actor ? actor.get('id') : null);
    }
    const at = new Date();
    await db.AuditLog.bulkCreate(
      entries.map((input) => ({
        at,
        by: input.by,
        actor_id: actors.get(input.by) ?? null,
        role: input.role,
        entity_type: input.entityType,
        entity_id: input.entityId || null,
        action: fit(input.action),
        previous_status: fit(input.previousStatus),
        new_status: fit(input.newStatus),
        remarks: input.remarks || '',
        ip: input.ip || ''
      })) as never
    );
  } catch {
    // never let audit logging break the actual workflow action
  }
}

// One entity's history, newest first — used by the TMS project/task,
// travel-schedule and general-task detail pages, which each want the trail
// for a single record. Deliberately still returns a plain array: those
// callers want every entry for one id, not a page of results.
export async function listAuditLog(entityType?: AuditLogEntry['entity_type'], entityId?: string): Promise<AuditLogEntry[]> {
  const where: Record<string, unknown> = {};
  if (entityType) where.entity_type = entityType;
  if (entityId) where.entity_id = entityId;
  const rows = await db.AuditLog.findAll({ where: where as never, order: [['at', 'DESC']] });
  return rows.map(toRecord);
}

export interface AuditLogFilters {
  entityType?: AuditLogEntry['entity_type'];
  entityId?: string;
  // Free text across the columns a person actually searches by: who did it,
  // what the action was, the remark, the record id, the IP.
  search?: string;
  by?: string;
  role?: string;
  // Inclusive 'YYYY-MM-DD' bounds on `at`.
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

export interface AuditLogPage {
  entries: AuditLogEntry[];
  total: number;
  page: number;
  pageSize: number;
  // Dropdown options, built from the WHOLE table rather than the current
  // result — narrowing by user must not empty the role list and strand
  // someone with no way back.
  facets: { users: string[]; roles: string[] };
}

const MAX_PAGE_SIZE = 200;

// The Audit Log page's search: filtered and paginated in SQL. Separate from
// listAuditLog above because the shapes genuinely differ — a page of results
// with a total and facets, versus one record's full history.
export async function searchAuditLog(filters: AuditLogFilters = {}): Promise<AuditLogPage> {
  const where: Record<string | symbol, unknown> = {};
  if (filters.entityType) where.entity_type = filters.entityType;
  if (filters.entityId) where.entity_id = filters.entityId;
  if (filters.by) where.by = filters.by;
  if (filters.role) where.role = filters.role;

  // A bare 'YYYY-MM-DD' "to" means the END of that day. Without the shift to
  // the next midnight, picking the same day for from and to matches nothing
  // — the classic off-by-one in every date filter.
  const from = filters.dateFrom ? new Date(`${filters.dateFrom}T00:00:00`) : null;
  const to = filters.dateTo ? new Date(`${filters.dateTo}T00:00:00`) : null;
  if (to) to.setDate(to.getDate() + 1);
  if (from && to) where.at = { [Op.gte]: from, [Op.lt]: to };
  else if (from) where.at = { [Op.gte]: from };
  else if (to) where.at = { [Op.lt]: to };

  const search = (filters.search ?? '').trim();
  if (search) {
    const like = { [Op.iLike]: `%${search}%` };
    where[Op.or as unknown as string] = [
      { by: like },
      { action: like },
      { remarks: like },
      { new_status: like },
      { previous_status: like },
      { ip: like }
    ];
  }

  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, filters.pageSize ?? 50));

  // Paginated in SQL, not in memory: this table only grows, and the page
  // used to fetch every row on every load.
  const [{ count, rows }, users, roles] = await Promise.all([
    db.AuditLog.findAndCountAll({
      where: where as never,
      order: [['at', 'DESC']],
      limit: pageSize,
      offset: (page - 1) * pageSize
    }),
    db.AuditLog.findAll({ attributes: ['by'], group: ['by'], order: [['by', 'ASC']] }),
    db.AuditLog.findAll({ attributes: ['role'], group: ['role'], order: [['role', 'ASC']] })
  ]);

  return {
    entries: rows.map(toRecord),
    total: count,
    page,
    pageSize,
    facets: {
      users: users.map((r) => String(r.get('by') ?? '')).filter(Boolean),
      roles: roles.map((r) => String(r.get('role') ?? '')).filter(Boolean)
    }
  };
}
