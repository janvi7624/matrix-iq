import { Model, Op } from 'sequelize';
import { db, isUuid } from './db';
import { LeaveRequestRecord, LeaveStatus, LeaveType } from './types';

const INCLUDES = [
  { model: db.User, as: 'user', attributes: ['id', 'username', 'name'] },
  { model: db.User, as: 'approvedBy', attributes: ['id', 'username', 'name'] }
];

function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

function toRecord(row: Model): LeaveRequestRecord {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const user = plain.user as { name?: string; username?: string } | null;
  const approvedBy = plain.approvedBy as { name?: string; username?: string } | null;
  return {
    id: plain.id as string,
    user_id: plain.user_id as string,
    user_name: user?.name ?? user?.username ?? '',
    leave_type: plain.leave_type as LeaveType,
    start_date: String(plain.start_date),
    end_date: String(plain.end_date),
    days: Number(plain.days) || 0,
    reason: (plain.reason as string) ?? '',
    status: plain.status as LeaveStatus,
    approved_by_name: approvedBy?.name ?? approvedBy?.username ?? '',
    approved_at: isoOrEmpty(plain.approved_at),
    remarks: (plain.remarks as string) ?? '',
    created_at: isoOrEmpty(plain.createdAt)
  };
}

function inclusiveDayCount(start: string, end: string): number {
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  return Math.max(1, Math.round((e.getTime() - s.getTime()) / 86400000) + 1);
}

export class InvalidLeaveRequestError extends Error {}

export async function applyLeave(input: { userId: string; leaveType: LeaveType; startDate: string; endDate: string; reason: string }): Promise<LeaveRequestRecord> {
  if (input.endDate < input.startDate) throw new InvalidLeaveRequestError('End date cannot be before start date.');
  const days = inclusiveDayCount(input.startDate, input.endDate);
  const row = await db.LeaveRequest.create({
    user_id: input.userId,
    leave_type: input.leaveType,
    start_date: input.startDate,
    end_date: input.endDate,
    days,
    reason: input.reason || '',
    status: 'pending'
  } as never);
  const withAssoc = await db.LeaveRequest.findByPk(row.get('id') as string, { include: INCLUDES as never });
  return toRecord(withAssoc as Model);
}

export async function decide(id: string, status: Extract<LeaveStatus, 'approved' | 'rejected'>, approvedByUserId: string, remarks?: string): Promise<LeaveRequestRecord | null> {
  if (!isUuid(id)) return null;
  const row = await db.LeaveRequest.findByPk(id);
  if (!row) return null;
  await row.update({ status, approved_by: approvedByUserId, approved_at: new Date(), remarks: remarks || '' } as never);
  const withAssoc = await db.LeaveRequest.findByPk(id, { include: INCLUDES as never });
  return toRecord(withAssoc as Model);
}

export async function cancel(id: string, userId: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const [count] = await db.LeaveRequest.update({ status: 'cancelled' } as never, { where: { id, user_id: userId, status: 'pending' } as never });
  return count > 0;
}

export async function findById(id: string): Promise<LeaveRequestRecord | undefined> {
  if (!isUuid(id)) return undefined;
  const row = await db.LeaveRequest.findByPk(id, { include: INCLUDES as never });
  return row ? toRecord(row) : undefined;
}

export async function list(filters: { userIds?: string[]; status?: LeaveStatus }): Promise<LeaveRequestRecord[]> {
  const where: Record<string | symbol, unknown> = {};
  if (filters.userIds) where.user_id = { [Op.in]: filters.userIds };
  if (filters.status) where.status = filters.status;
  const rows = await db.LeaveRequest.findAll({ where: where as never, include: INCLUDES as never, order: [['createdAt', 'DESC']] });
  return rows.map(toRecord);
}
