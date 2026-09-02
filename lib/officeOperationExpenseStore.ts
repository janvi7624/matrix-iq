import { Model, Op } from 'sequelize';
import { OfficeOperationExpenseRecord } from './types';
import { db, isUuid } from './db';

// Same private helper the other stores each define (see e.g.
// lib/marketingRequestStore.ts) — a raw Sequelize DATE comes back as a Date
// object, and String()-ing it would emit a locale string like
// "Mon Aug 31 2026 11:28:49 GMT+0530" instead of an ISO timestamp.
function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

// `position` is the row's place in the date-ordered register, and it is what
// becomes the visible Sr No. The stored sr_no column is NOT shown: it comes
// from a global Postgres sequence, so it keeps counting across months and
// leaves gaps wherever a row was deleted (0002, 0003, 0007…). What HR wants on
// the register is a plain running number, so the serial is derived from
// position at read time and the stored column is kept only as the stable
// creation-order tiebreaker for rows sharing a date.
function toRecord(row: Model, position?: number): OfficeOperationExpenseRecord {
  const p = row.get({ plain: true }) as Record<string, unknown>;
  const creatorObj = p.creator as Record<string, unknown> | undefined;
  return {
    id: p.id as string,
    sr_no: position ?? (Number(p.sr_no) || 0),
    // `underscored: true` snake-cases the COLUMN but leaves the model
    // attribute as createdAt/updatedAt, so `.get({ plain: true })` keys these
    // in camelCase — reading p.created_at here silently yielded '' on every
    // record. The snake_case fallback covers the explicitly-declared columns
    // in case these are ever defined as real attributes.
    created_at: isoOrEmpty(p.createdAt ?? p.created_at),
    updated_at: isoOrEmpty(p.updatedAt ?? p.updated_at),
    created_by: (creatorObj?.username as string) ?? '',
    creator_name: (creatorObj?.name as string) || (creatorObj?.username as string) || '',
    date: p.date ? String(p.date) : '',
    usecase: (p.usecase as string) ?? '',
    usecase_detail: (p.usecase_detail as string) ?? '',
    item_name: (p.item_name as string) ?? '',
    item_sub_names: (p.item_sub_names as string[]) ?? [],
    // Preserved as null rather than coerced to 0 — "not specified" and "zero"
    // are different things, and Number(null) would quietly report 0.
    item_qty: p.item_qty === null || p.item_qty === undefined ? null : Number(p.item_qty),
    amount: Number(p.amount) || 0,
    description: (p.description as string) ?? '',
    remarks: (p.remarks as string) ?? ''
  };
}

const INCLUDE_CREATOR = [{ model: db.User, as: 'creator', attributes: ['id', 'username', 'name'] }];

export interface OfficeOperationExpenseInput {
  date: string;
  usecase: string;
  usecase_detail: string;
  item_name: string;
  item_sub_names: string[];
  item_qty: number | null;
  amount: number;
  description: string;
  remarks: string;
}

// Every field a client is allowed to change on an existing row. `sr_no`,
// `created_by`, and the timestamps are absent on purpose — the serial is
// DB-assigned and permanent, and attribution shouldn't be rewritable from a
// PATCH body (same allow-list approach as lib/reimbursementStore.ts's update).
const EDITABLE_FIELDS = ['date', 'usecase', 'usecase_detail', 'item_name', 'item_sub_names', 'item_qty', 'amount', 'description', 'remarks'];

// This module is HR-only (see lib/officeOperationExpenseAccess.ts), so there's
// no own-records-vs-everyone scoping to apply the way the org-wide modules
// need: everyone who can reach it at all sees the whole register. Access is
// decided before this store is ever called.
async function list(year: number, month: number): Promise<OfficeOperationExpenseRecord[]> {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endMonth = month === 12 ? 1 : month + 1;
  const endYear = month === 12 ? year + 1 : year;
  const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}-01`;

  const rows = await db.OfficeOperationExpense.findAll({
    where: { date: { [Op.gte]: startDate, [Op.lt]: endDate } } as never,
    include: INCLUDE_CREATOR as never,
    // Date first, then creation order for entries sharing a date, so the
    // numbering below is stable and reproducible.
    order: [['date', 'ASC'], ['sr_no', 'ASC']]
  });
  // 1, 2, 3 … down the month, with no gaps — renumbering itself whenever an
  // entry is added or removed.
  return rows.map((row, i) => toRecord(row, i + 1));
}

async function findById(id: string): Promise<OfficeOperationExpenseRecord | null> {
  if (!isUuid(id)) return null;
  const row = await db.OfficeOperationExpense.findByPk(id, { include: INCLUDE_CREATOR as never });
  return row ? toRecord(row) : null;
}

async function create(viewerUsername: string, data: OfficeOperationExpenseInput): Promise<OfficeOperationExpenseRecord> {
  const viewer = await db.User.findOne({ where: { username: viewerUsername } as never, attributes: ['id'] });
  if (!viewer) throw new Error('User not found');
  const viewerId = (viewer.get({ plain: true }) as Record<string, unknown>).id as string;

  // sr_no is omitted deliberately — the column's Postgres sequence default
  // assigns it atomically (see the migration), so concurrent HR saves can't
  // collide on a serial.
  const row = await db.OfficeOperationExpense.create({
    created_by: viewerId,
    date: data.date,
    usecase: data.usecase,
    usecase_detail: data.usecase_detail,
    item_name: data.item_name,
    item_sub_names: data.item_sub_names,
    item_qty: data.item_qty,
    amount: data.amount,
    description: data.description,
    remarks: data.remarks
  } as never);

  // Re-read so the response carries the sequence-assigned sr_no and the
  // creator's display name, neither of which the create() instance has.
  const created = await db.OfficeOperationExpense.findByPk(
    (row.get({ plain: true }) as Record<string, unknown>).id as string,
    { include: INCLUDE_CREATOR as never }
  );
  return toRecord(created!);
}

async function update(id: string, patch: Record<string, unknown>): Promise<OfficeOperationExpenseRecord | null> {
  if (!isUuid(id)) return null;
  const row = await db.OfficeOperationExpense.findByPk(id);
  if (!row) return null;

  const attrs: Record<string, unknown> = {};
  for (const key of EDITABLE_FIELDS) {
    if (patch[key] !== undefined) attrs[key] = patch[key];
  }
  if (Object.keys(attrs).length) await row.update(attrs as never);

  const updated = await db.OfficeOperationExpense.findByPk(id, { include: INCLUDE_CREATOR as never });
  return toRecord(updated!);
}

async function remove(id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const row = await db.OfficeOperationExpense.findByPk(id);
  if (!row) return false;
  await row.destroy();
  return true;
}

export const officeOperationExpenseStore = { list, findById, create, update, remove };
