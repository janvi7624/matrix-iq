import { Model, Op } from 'sequelize';
import { db, isUuid } from './db';
import { AttendanceRecordEntry, AttendanceStatus } from './types';

const INCLUDES = [
  { model: db.User, as: 'user', attributes: ['id', 'username', 'name'] },
  { model: db.User, as: 'markedBy', attributes: ['id', 'username', 'name'] }
];

function toRecord(row: Model): AttendanceRecordEntry {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const user = plain.user as { name?: string; username?: string } | null;
  const markedBy = plain.markedBy as { name?: string; username?: string } | null;
  return {
    id: plain.id as string,
    user_id: plain.user_id as string,
    user_name: user?.name ?? user?.username ?? '',
    date: String(plain.date),
    status: plain.status as AttendanceStatus,
    marked_by_name: markedBy?.name ?? markedBy?.username ?? '',
    remarks: (plain.remarks as string) ?? ''
  };
}

// One row per (user, date) — re-marking the same day updates it in place
// rather than creating a duplicate, enforced by the DB's unique index.
export async function markAttendance(input: { userId: string; date: string; status: AttendanceStatus; markedByUserId: string; remarks?: string }): Promise<AttendanceRecordEntry> {
  const existing = await db.AttendanceRecord.findOne({ where: { user_id: input.userId, date: input.date } as never });
  if (existing) {
    await existing.update({ status: input.status, marked_by: input.markedByUserId, remarks: input.remarks || '' } as never);
  } else {
    await db.AttendanceRecord.create({ user_id: input.userId, date: input.date, status: input.status, marked_by: input.markedByUserId, remarks: input.remarks || '' } as never);
  }
  const row = await db.AttendanceRecord.findOne({ where: { user_id: input.userId, date: input.date } as never, include: INCLUDES as never });
  return toRecord(row as Model);
}

export async function listForDate(date: string, userIds?: string[]): Promise<AttendanceRecordEntry[]> {
  const where: Record<string, unknown> = { date };
  if (userIds) where.user_id = userIds;
  const rows = await db.AttendanceRecord.findAll({ where: where as never, include: INCLUDES as never });
  return rows.map(toRecord);
}

export async function listForUser(userId: string, from: string, to: string): Promise<AttendanceRecordEntry[]> {
  if (!isUuid(userId)) return [];
  const rows = await db.AttendanceRecord.findAll({
    where: { user_id: userId, date: { [Op.between]: [from, to] } } as never,
    include: INCLUDES as never,
    order: [['date', 'DESC']]
  });
  return rows.map(toRecord);
}
