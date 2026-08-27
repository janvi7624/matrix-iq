import { Model, Op } from 'sequelize';
import { ReimbursementRecord } from './types';
import { db, isUuid } from './db';

function toRecord(row: Model, companionMap?: Map<string, string>): ReimbursementRecord {
  const p = row.get({ plain: true }) as Record<string, unknown>;
  const employeeIds: string[] = (p.employee_ids as string[]) ?? [];
  const creatorObj = p.creator as Record<string, unknown> | undefined;
  return {
    id: p.id as string,
    created_at: p.created_at ? String(p.created_at) : '',
    created_by: creatorObj?.username as string ?? '',
    creator_name: (creatorObj?.name as string) || (creatorObj?.username as string) || '',
    date: p.date ? String(p.date) : '',
    description: (p.description as string) ?? '',
    employee_ids: employeeIds,
    employee_names: companionMap ? employeeIds.map((id) => companionMap.get(id) || id) : [],
    from_location: (p.from_location as string) ?? '',
    to_location: (p.to_location as string) ?? '',
    kilometers: Number(p.kilometers) || 0,
    amount: Number(p.amount) || 0,
    mode_of_payment: (p.mode_of_payment as string) ?? '',
    amount_in_words: (p.amount_in_words as string) ?? '',
    attachment_urls: (p.attachment_urls as string[]) ?? [],
    is_admin_entry: (p.is_admin_entry as boolean) ?? false,
    admin_note: (p.admin_note as string) ?? '',
    admin_total_amount: Number(p.admin_total_amount) || 0,
    admin_split_count: Number(p.admin_split_count) || 0,
  };
}

const INCLUDE_CREATOR = [{ model: db.User, as: 'creator', attributes: ['id', 'username', 'name'] }];

async function resolveEmployeeNames(records: ReimbursementRecord[]): Promise<void> {
  const allIds = new Set<string>();
  records.forEach((r) => r.employee_ids.forEach((id) => allIds.add(id)));
  if (!allIds.size) return;
  const users = await db.User.findAll({ where: { id: [...allIds] } as never, attributes: ['id', 'name', 'username'] });
  const map = new Map<string, string>();
  users.forEach((u) => {
    const p = u.get({ plain: true }) as Record<string, unknown>;
    map.set(p.id as string, (p.name as string) || (p.username as string) || (p.id as string));
  });
  records.forEach((r) => { r.employee_names = r.employee_ids.map((id) => map.get(id) || id); });
}

async function list(viewerUsername: string, isPrivileged: boolean, year: number, month: number): Promise<ReimbursementRecord[]> {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endMonth = month === 12 ? 1 : month + 1;
  const endYear = month === 12 ? year + 1 : year;
  const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}-01`;

  const where: Record<string, unknown> = {
    date: { [Op.gte]: startDate, [Op.lt]: endDate },
    is_admin_entry: false,
  };

  if (!isPrivileged) {
    const viewer = await db.User.findOne({ where: { username: viewerUsername } as never, attributes: ['id'] });
    if (!viewer) return [];
    const viewerId = (viewer.get({ plain: true }) as Record<string, unknown>).id as string;
    where[Op.or as unknown as string] = [
      { created_by: viewerId },
      db.sequelize.literal(`employee_ids @> '"${viewerId}"'`)
    ];
  }

  const rows = await db.Reimbursement.findAll({ where: where as never, include: INCLUDE_CREATOR as never, order: [['date', 'ASC'], ['created_at', 'ASC']] });
  const records = rows.map((r) => toRecord(r));
  await resolveEmployeeNames(records);
  return records;
}

async function findById(id: string): Promise<ReimbursementRecord | null> {
  if (!isUuid(id)) return null;
  const row = await db.Reimbursement.findByPk(id, { include: INCLUDE_CREATOR as never });
  if (!row) return null;
  const record = toRecord(row);
  await resolveEmployeeNames([record]);
  return record;
}

async function create(viewerUsername: string, data: {
  date: string; description: string; employee_ids: string[];
  from_location: string; to_location: string; kilometers: number;
  amount: number; mode_of_payment: string; amount_in_words: string;
  attachment_urls: string[];
}): Promise<ReimbursementRecord> {
  const viewer = await db.User.findOne({ where: { username: viewerUsername } as never, attributes: ['id'] });
  if (!viewer) throw new Error('User not found');
  const viewerId = (viewer.get({ plain: true }) as Record<string, unknown>).id as string;

  const row = await db.Reimbursement.create({
    created_by: viewerId,
    date: data.date,
    description: data.description,
    employee_ids: data.employee_ids,
    from_location: data.from_location,
    to_location: data.to_location,
    kilometers: data.kilometers || null,
    amount: data.amount,
    mode_of_payment: data.mode_of_payment,
    amount_in_words: data.amount_in_words,
    attachment_urls: data.attachment_urls
  } as never);

  const created = await db.Reimbursement.findByPk(
    (row.get({ plain: true }) as Record<string, unknown>).id as string,
    { include: INCLUDE_CREATOR as never }
  );
  const record = toRecord(created!);
  await resolveEmployeeNames([record]);
  return record;
}

async function update(id: string, patch: Record<string, unknown>): Promise<ReimbursementRecord | null> {
  if (!isUuid(id)) return null;
  const row = await db.Reimbursement.findByPk(id);
  if (!row) return null;

  const allowed = ['date', 'description', 'employee_ids', 'from_location', 'to_location', 'kilometers', 'amount', 'mode_of_payment', 'amount_in_words', 'attachment_urls'];
  const attrs: Record<string, unknown> = {};
  for (const key of allowed) {
    if (patch[key] !== undefined) attrs[key] = patch[key];
  }
  if (Object.keys(attrs).length) await row.update(attrs as never);

  const updated = await db.Reimbursement.findByPk(id, { include: INCLUDE_CREATOR as never });
  const record = toRecord(updated!);
  await resolveEmployeeNames([record]);
  return record;
}

async function remove(id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const row = await db.Reimbursement.findByPk(id);
  if (!row) return false;
  await row.destroy();
  return true;
}

async function listByUserId(userId: string, year: number, month: number): Promise<ReimbursementRecord[]> {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endMonth = month === 12 ? 1 : month + 1;
  const endYear = month === 12 ? year + 1 : year;
  const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}-01`;

  const rows = await db.Reimbursement.findAll({
    where: { created_by: userId, date: { [Op.gte]: startDate, [Op.lt]: endDate } } as never,
    include: INCLUDE_CREATOR as never,
    order: [['date', 'ASC'], ['created_at', 'ASC']],
  });
  const records = rows.map((r) => toRecord(r));
  await resolveEmployeeNames(records);
  return records;
}

export const reimbursementStore = { list, listByUserId, findById, create, update, remove };
