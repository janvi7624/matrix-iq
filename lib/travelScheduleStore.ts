import { Model } from 'sequelize';
import { TravelScheduleRecord, TravelScheduleStatus, TravelCoTraveller, TravelHotelRequest, TravelAdvanceRequest } from './types';
import { db, isUuid } from './db';

// Shared shape-sanitizers for the 3 new structured fields — used by both
// POST (create) and PUT (update) so the two API routes can't drift apart on
// what counts as a valid entry.
export function sanitizeCoTravellers(input: unknown): TravelCoTraveller[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((v): v is Record<string, unknown> => !!v && typeof v === 'object')
    .map((o) => ({
      name: typeof o.name === 'string' ? o.name.trim() : '',
      contact: typeof o.contact === 'string' ? o.contact.trim() : '',
      origin: typeof o.origin === 'string' ? o.origin.trim() : '',
      destination: typeof o.destination === 'string' ? o.destination.trim() : '',
      travelDate: typeof o.travelDate === 'string' ? o.travelDate : ''
    }))
    .filter((c) => c.name);
}

export function sanitizeHotelAccommodation(input: unknown): TravelHotelRequest | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;
  if (!o.required) return { required: false, preferredArea: '', suggestedHotel: '', location: '', checkInDate: '', checkOutDate: '', numberOfGuests: 0, additionalRequirement: '' };
  return {
    required: true,
    preferredArea: typeof o.preferredArea === 'string' ? o.preferredArea.trim() : '',
    suggestedHotel: typeof o.suggestedHotel === 'string' ? o.suggestedHotel.trim() : '',
    location: typeof o.location === 'string' ? o.location.trim() : '',
    checkInDate: typeof o.checkInDate === 'string' ? o.checkInDate : '',
    checkOutDate: typeof o.checkOutDate === 'string' ? o.checkOutDate : '',
    numberOfGuests: Number(o.numberOfGuests) || 0,
    additionalRequirement: typeof o.additionalRequirement === 'string' ? o.additionalRequirement.trim() : ''
  };
}

export function sanitizeAdvanceRequest(input: unknown): TravelAdvanceRequest | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;
  if (!o.required) return { required: false, requestedAmount: 0, remark: '' };
  return {
    required: true,
    requestedAmount: Number(o.requestedAmount) || 0,
    remark: typeof o.remark === 'string' ? o.remark.trim() : ''
  };
}

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
  { name: 'purpose_other' },
  { name: 'mode_of_travel' },
  { name: 'linked_client' },
  { name: 'project_id', kind: 'nullable' as const },
  { name: 'project_ids', kind: 'json' as const },
  { name: 'travel_suggestion' },
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
  { name: 'companion_ids', kind: 'json' as const },
  { name: 'co_travellers', kind: 'json' as const },
  { name: 'hotel_accommodation', kind: 'jsonObject' as const },
  { name: 'advance_request', kind: 'jsonObject' as const },
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
  if (kind === 'jsonObject') return value === undefined ? null : value;
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
    hr_final_verifier_name: (plain.hrFinalVerifier as { name?: string } | null)?.name ?? '',
    companion_names: [],
    project_names: []
  };
  for (const { name, kind = 'string' } of FIELDS) {
    const raw = plain[name];
    if (kind === 'nullable') record[name] = raw ?? '';
    else if (kind === 'date') record[name] = isoOrEmpty(raw);
    else if (kind === 'number') record[name] = raw === null || raw === undefined ? 0 : Number(raw);
    else if (kind === 'json') record[name] = raw ?? [];
    else if (kind === 'jsonObject') record[name] = raw ?? null;
    else record[name] = raw ?? '';
  }
  return record as unknown as TravelScheduleRecord;
}

async function resolveCompanionNames(records: TravelScheduleRecord[]): Promise<void> {
  const allIds = new Set<string>();
  for (const r of records) {
    if (Array.isArray(r.companion_ids)) r.companion_ids.forEach((id) => allIds.add(id));
  }
  if (allIds.size === 0) return;
  const { Op } = await import('sequelize');
  const users = await db.User.findAll({ where: { id: { [Op.in]: [...allIds] } } as never, attributes: ['id', 'name', 'username'] });
  const nameMap = new Map<string, string>();
  for (const u of users) {
    const plain = u.get({ plain: true }) as { id: string; name?: string; username?: string };
    nameMap.set(plain.id, plain.name || plain.username || plain.id);
  }
  for (const r of records) {
    if (Array.isArray(r.companion_ids)) {
      (r as unknown as Record<string, unknown>).companion_names = r.companion_ids.map((id) => nameMap.get(id) || id);
    }
  }
}

async function resolveProjectNames(records: TravelScheduleRecord[]): Promise<void> {
  const allIds = new Set<string>();
  for (const r of records) {
    if (Array.isArray(r.project_ids)) r.project_ids.forEach((id) => allIds.add(id));
  }
  if (allIds.size === 0) return;
  const { Op } = await import('sequelize');
  const projects = await db.Project.findAll({ where: { id: { [Op.in]: [...allIds] } } as never, attributes: ['id', 'client_name', 'company'] });
  const nameMap = new Map<string, string>();
  for (const p of projects) {
    const plain = p.get({ plain: true }) as { id: string; client_name?: string; company?: string };
    nameMap.set(plain.id, plain.client_name ? `${plain.client_name}${plain.company ? ` (${plain.company})` : ''}` : plain.id);
  }
  for (const r of records) {
    if (Array.isArray(r.project_ids)) {
      (r as unknown as Record<string, unknown>).project_names = r.project_ids.map((id) => nameMap.get(id) || id);
    }
  }
}

async function list(viewerUsername: string, viewerIsPrivileged: boolean): Promise<TravelScheduleRecord[]> {
  let where: Record<string | symbol, unknown> = {};
  if (!viewerIsPrivileged) {
    const { Op, literal } = await import('sequelize');
    const user = await db.User.findOne({ where: { username: viewerUsername } as never });
    const userId = user ? (user.get('id') as string) : '00000000-0000-0000-0000-000000000000';
    where = {
      [Op.or]: [
        { created_by: userId },
        literal(`companion_ids @> '"${userId}"'`)
      ]
    };
  }
  const rows = await db.TravelSchedule.findAll({ where: where as never, include: allIncludes(), order: [['created_at', 'DESC']] });
  const records = rows.map(toRecord);
  await resolveCompanionNames(records);
  await resolveProjectNames(records);
  return records;
}

async function findById(id: string): Promise<TravelScheduleRecord | undefined> {
  if (!isUuid(id)) return undefined;
  const row = await db.TravelSchedule.findByPk(id, { include: allIncludes() });
  if (!row) return undefined;
  const record = toRecord(row);
  await resolveCompanionNames([record]);
  await resolveProjectNames([record]);
  return record;
}

// Keeps the legacy singular project_id in sync with project_ids[0] — the
// authoritative source once set — so any caller that only ever populates
// project_ids (rather than remembering to also set project_id) still gets a
// consistent record. Mutates in place; called by both create() and update()
// so this can't drift between the two API routes that reach them.
function syncLegacyProjectId(attrs: Record<string, unknown>): void {
  if ('project_ids' in attrs) {
    const ids = Array.isArray(attrs.project_ids) ? (attrs.project_ids as string[]) : [];
    attrs.project_id = ids[0] || null;
  }
}

async function create(record: TravelScheduleRecord): Promise<TravelScheduleRecord> {
  const attrs: Record<string, unknown> = {};
  for (const { name, kind = 'string' } of FIELDS) attrs[name] = toAttr((record as unknown as Record<string, unknown>)[name], kind);
  syncLegacyProjectId(attrs);
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
  syncLegacyProjectId(attrs);
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
