import { Model } from 'sequelize';
import { TravelScheduleRecord, TravelScheduleStatus } from './types';
import { db, isUuid } from './db';

const FIELDS = [
  { name: 'request_code' },
  { name: 'status' },
  { name: 'origin' },
  { name: 'destination' },
  { name: 'start_date', kind: 'nullable' as const },
  { name: 'end_date', kind: 'nullable' as const },
  { name: 'required_arrival_time' },
  { name: 'expected_departure_time' },
  { name: 'purpose' },
  { name: 'linked_client' },
  { name: 'expense_note' },
  { name: 'project_id', kind: 'nullable' as const },
  { name: 'manager_id', kind: 'nullable' as const },
  { name: 'manager_action_at', kind: 'date' as const },
  { name: 'manager_remarks' },
  { name: 'hr_reviewer_id', kind: 'nullable' as const },
  { name: 'hr_reviewed_at', kind: 'date' as const },
  { name: 'hr_remarks' },
  { name: 'hr_documents', kind: 'json' as const },
  { name: 'estimated_cost', kind: 'number' as const },
  { name: 'admin_reviewer_id', kind: 'nullable' as const },
  { name: 'admin_reviewed_at', kind: 'date' as const },
  { name: 'admin_remarks' },
  { name: 'accounts_handler_id', kind: 'nullable' as const },
  { name: 'accounts_completed_at', kind: 'date' as const },
  { name: 'booking_details' },
  { name: 'ticket_documents', kind: 'json' as const },
  { name: 'actual_cost', kind: 'number' as const },
  { name: 'hr_final_verifier_id', kind: 'nullable' as const },
  { name: 'hr_final_verified_at', kind: 'date' as const },
  { name: 'hr_final_remarks' },
  { name: 'change_request_remarks' },
  { name: 'change_requested_by' }
];

function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

function toAttr(value: unknown, kind: string): unknown {
  if (kind === 'nullable' || kind === 'date') return value === '' || value === undefined ? null : value;
  if (kind === 'number') return value === '' || value === undefined || value === null ? null : value;
  return value;
}

function allIncludes() {
  return [
    { model: db.User, as: 'creator', attributes: ['id', 'username', 'name'] },
    { model: db.Project, as: 'project', attributes: ['id', 'client_name', 'company'] },
    { model: db.User, as: 'manager', attributes: ['id', 'name'] },
    { model: db.User, as: 'hrReviewer', attributes: ['id', 'name'] },
    { model: db.User, as: 'adminReviewer', attributes: ['id', 'name'] },
    { model: db.User, as: 'accountsHandler', attributes: ['id', 'name'] },
    { model: db.User, as: 'hrFinalVerifier', attributes: ['id', 'name'] }
  ];
}

function toRecord(row: Model): TravelScheduleRecord {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const record: Record<string, unknown> = {
    id: plain.id,
    created_at: isoOrEmpty(plain.createdAt),
    created_by: (plain.creator as { username?: string } | null)?.username ?? '',
    project_name: (plain.project as { client_name?: string; company?: string } | null)?.client_name
      ? `${(plain.project as { client_name: string }).client_name}${(plain.project as { company?: string }).company ? ` (${(plain.project as { company: string }).company})` : ''}`
      : '',
    manager_name: (plain.manager as { name?: string } | null)?.name ?? '',
    hr_reviewer_name: (plain.hrReviewer as { name?: string } | null)?.name ?? '',
    admin_reviewer_name: (plain.adminReviewer as { name?: string } | null)?.name ?? '',
    accounts_handler_name: (plain.accountsHandler as { name?: string } | null)?.name ?? '',
    hr_final_verifier_name: (plain.hrFinalVerifier as { name?: string } | null)?.name ?? ''
  };
  for (const { name, kind = 'string' } of FIELDS) {
    const raw = plain[name];
    if (kind === 'nullable') record[name] = raw ?? '';
    else if (kind === 'date') record[name] = isoOrEmpty(raw);
    else if (kind === 'number') record[name] = raw === null || raw === undefined ? 0 : Number(raw);
    else if (kind === 'json') record[name] = raw ?? [];
    else record[name] = raw ?? '';
  }
  return record as unknown as TravelScheduleRecord;
}

async function list(viewerUsername: string, viewerIsPrivileged: boolean): Promise<TravelScheduleRecord[]> {
  const where: Record<string, unknown> = {};
  if (!viewerIsPrivileged) {
    const user = await db.User.findOne({ where: { username: viewerUsername } as never });
    where.created_by = user ? user.get('id') : '00000000-0000-0000-0000-000000000000';
  }
  const rows = await db.TravelSchedule.findAll({ where: where as never, include: allIncludes(), order: [['created_at', 'DESC']] });
  return rows.map(toRecord);
}

async function findById(id: string): Promise<TravelScheduleRecord | undefined> {
  if (!isUuid(id)) return undefined;
  const row = await db.TravelSchedule.findByPk(id, { include: allIncludes() });
  if (!row) return undefined;
  return toRecord(row);
}

async function create(record: TravelScheduleRecord): Promise<TravelScheduleRecord> {
  const attrs: Record<string, unknown> = {};
  for (const { name, kind = 'string' } of FIELDS) attrs[name] = toAttr((record as unknown as Record<string, unknown>)[name], kind);
  const creator = await db.User.findOne({ where: { username: record.created_by } as never });
  attrs.created_by = creator ? creator.get('id') : null;
  attrs.request_code = await nextTravelRequestCode();
  attrs.status = 'draft';

  const row = await db.TravelSchedule.create(attrs as never);
  const withAssoc = await db.TravelSchedule.findByPk(row.get('id') as string, { include: allIncludes() });
  return toRecord(withAssoc as Model);
}

async function update(id: string, patch: Partial<TravelScheduleRecord>): Promise<TravelScheduleRecord | null> {
  if (!isUuid(id)) return null;
  const row = await db.TravelSchedule.findByPk(id);
  if (!row) return null;
  const attrs: Record<string, unknown> = {};
  const patchObj = patch as unknown as Record<string, unknown>;
  for (const { name, kind = 'string' } of FIELDS) {
    if (name in patchObj) attrs[name] = toAttr(patchObj[name], kind);
  }
  await row.update(attrs as never);
  const withAssoc = await db.TravelSchedule.findByPk(id, { include: allIncludes() });
  return toRecord(withAssoc as Model);
}

// draft -> submitted
async function submit(id: string): Promise<TravelScheduleRecord | null> {
  return update(id, { status: 'submitted', change_request_remarks: '', change_requested_by: '' } as Partial<TravelScheduleRecord>);
}

// submitted -> manager_approved | changes_requested
async function managerDecide(id: string, decision: 'manager_approved' | 'changes_requested', actorUsername: string, remarks?: string): Promise<TravelScheduleRecord | null> {
  if (!isUuid(id)) return null;
  const row = await db.TravelSchedule.findByPk(id);
  if (!row) return null;
  const actor = await db.User.findOne({ where: { username: actorUsername } as never });
  const attrs: Record<string, unknown> = {
    status: decision,
    manager_id: actor ? actor.get('id') : null,
    manager_action_at: new Date(),
    manager_remarks: remarks || ''
  };
  if (decision === 'changes_requested') {
    attrs.change_request_remarks = remarks || '';
    attrs.change_requested_by = 'Department Manager';
  }
  await row.update(attrs as never);
  const withAssoc = await db.TravelSchedule.findByPk(id, { include: allIncludes() });
  return toRecord(withAssoc as Model);
}

// manager_approved -> hr_reviewed | changes_requested
async function hrReview(id: string, decision: 'hr_reviewed' | 'changes_requested', actorUsername: string, patch: { remarks?: string; hr_documents?: string[]; estimated_cost?: number }): Promise<TravelScheduleRecord | null> {
  if (!isUuid(id)) return null;
  const row = await db.TravelSchedule.findByPk(id);
  if (!row) return null;
  const actor = await db.User.findOne({ where: { username: actorUsername } as never });
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const existingDocs = Array.isArray(plain.hr_documents) ? (plain.hr_documents as string[]) : [];
  const newDocs = patch.hr_documents || [];
  const attrs: Record<string, unknown> = {
    status: decision,
    hr_reviewer_id: actor ? actor.get('id') : null,
    hr_reviewed_at: new Date(),
    hr_remarks: patch.remarks || '',
    hr_documents: [...existingDocs, ...newDocs],
    estimated_cost: patch.estimated_cost ?? plain.estimated_cost ?? null
  };
  if (decision === 'changes_requested') {
    attrs.change_request_remarks = patch.remarks || '';
    attrs.change_requested_by = 'HR Department';
  }
  await row.update(attrs as never);
  const withAssoc = await db.TravelSchedule.findByPk(id, { include: allIncludes() });
  return toRecord(withAssoc as Model);
}

// hr_reviewed -> admin_approved | changes_requested
async function adminDecide(id: string, decision: 'admin_approved' | 'changes_requested', actorUsername: string, remarks?: string): Promise<TravelScheduleRecord | null> {
  if (!isUuid(id)) return null;
  const row = await db.TravelSchedule.findByPk(id);
  if (!row) return null;
  const actor = await db.User.findOne({ where: { username: actorUsername } as never });
  const attrs: Record<string, unknown> = {
    status: decision,
    admin_reviewer_id: actor ? actor.get('id') : null,
    admin_reviewed_at: new Date(),
    admin_remarks: remarks || ''
  };
  if (decision === 'changes_requested') {
    attrs.change_request_remarks = remarks || '';
    attrs.change_requested_by = 'Admin Department';
  }
  await row.update(attrs as never);
  const withAssoc = await db.TravelSchedule.findByPk(id, { include: allIncludes() });
  return toRecord(withAssoc as Model);
}

// admin_approved -> ticket_booking (accounts completes booking)
async function completeBooking(id: string, actorUsername: string, patch: { booking_details?: string; ticket_documents?: string[]; actual_cost?: number }): Promise<TravelScheduleRecord | null> {
  if (!isUuid(id)) return null;
  const row = await db.TravelSchedule.findByPk(id);
  if (!row) return null;
  const actor = await db.User.findOne({ where: { username: actorUsername } as never });
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const existingDocs = Array.isArray(plain.ticket_documents) ? (plain.ticket_documents as string[]) : [];
  const newDocs = patch.ticket_documents || [];
  const attrs: Record<string, unknown> = {
    status: 'ticket_booking' as TravelScheduleStatus,
    accounts_handler_id: actor ? actor.get('id') : null,
    accounts_completed_at: new Date(),
    booking_details: patch.booking_details || '',
    ticket_documents: [...existingDocs, ...newDocs],
    actual_cost: patch.actual_cost ?? plain.actual_cost ?? null
  };
  await row.update(attrs as never);
  const withAssoc = await db.TravelSchedule.findByPk(id, { include: allIncludes() });
  return toRecord(withAssoc as Model);
}

// ticket_booking -> hr_final_verification | changes_requested (HR sends back to accounts/others)
async function hrFinalVerify(id: string, decision: 'completed' | 'changes_requested', actorUsername: string, remarks?: string): Promise<TravelScheduleRecord | null> {
  if (!isUuid(id)) return null;
  const row = await db.TravelSchedule.findByPk(id);
  if (!row) return null;
  const actor = await db.User.findOne({ where: { username: actorUsername } as never });
  const attrs: Record<string, unknown> = {
    status: decision === 'completed' ? 'completed' : 'changes_requested',
    hr_final_verifier_id: actor ? actor.get('id') : null,
    hr_final_verified_at: new Date(),
    hr_final_remarks: remarks || ''
  };
  if (decision === 'changes_requested') {
    attrs.change_request_remarks = remarks || '';
    attrs.change_requested_by = 'HR (Final Verification)';
  }
  await row.update(attrs as never);
  const withAssoc = await db.TravelSchedule.findByPk(id, { include: allIncludes() });
  return toRecord(withAssoc as Model);
}

async function remove(id: string, viewerIsPrivileged: boolean): Promise<boolean> {
  if (!viewerIsPrivileged) return false;
  if (!isUuid(id)) return false;
  const row = await db.TravelSchedule.findByPk(id);
  if (!row) return false;
  await row.destroy();
  return true;
}

export const travelScheduleStore = {
  list, findById, create, update, submit,
  managerDecide, hrReview, adminDecide, completeBooking, hrFinalVerify,
  remove
};

// TR-<seq> code generation
export async function nextTravelRequestCode(): Promise<string> {
  const rows = await db.TravelSchedule.findAll({ attributes: ['request_code'], paranoid: false });
  const pattern = /^TR-(\d+)$/;
  const max = rows.reduce((acc: number, r: Model) => {
    const code = r.get('request_code') as string;
    const match = code ? code.match(pattern) : null;
    return match ? Math.max(acc, parseInt(match[1], 10)) : acc;
  }, 0);
  return `TR-${String(max + 1).padStart(4, '0')}`;
}
