import { Model } from 'sequelize';
import { TmsProjectPhaseRecord, TmsProjectPhaseStatus } from './types';
import { db, isUuid } from './db';

// Phase-wise delivery for a TMS project. Each phase carries its OWN expected
// end date, which is the point of the feature — tms_projects.deadline remains
// the whole project's controlled-extension date and is deliberately untouched
// by anything here.

function isoDateOrEmpty(value: unknown): string {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function toRecord(row: Model): TmsProjectPhaseRecord {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const creator = plain.creator as { username?: string; name?: string } | null;
  return {
    id: plain.id as string,
    tms_project_id: plain.tms_project_id as string,
    name: (plain.name as string) ?? '',
    description: (plain.description as string) ?? '',
    expected_end_date: isoDateOrEmpty(plain.expected_end_date),
    sequence: Number(plain.sequence ?? 0),
    status: (plain.status as TmsProjectPhaseStatus) ?? 'pending',
    completed_at: isoDateOrEmpty(plain.completed_at),
    created_by_name: creator?.name ?? creator?.username ?? '',
    created_at: plain.created_at ? new Date(plain.created_at as string).toISOString() : ''
  };
}

const INCLUDES = [{ model: db.User, as: 'creator', attributes: ['id', 'username', 'name'] }];

// Delivery order, then creation order as the tie-break so two phases added
// without an explicit sequence don't shuffle between reads.
const ORDER: [string, string][] = [
  ['sequence', 'ASC'],
  ['created_at', 'ASC']
];

export async function listPhases(tmsProjectId: string): Promise<TmsProjectPhaseRecord[]> {
  if (!isUuid(tmsProjectId)) return [];
  const rows = await db.TmsProjectPhase.findAll({
    where: { tms_project_id: tmsProjectId } as never,
    include: INCLUDES,
    order: ORDER as never
  });
  return rows.map(toRecord);
}

export interface CreatePhaseInput {
  tmsProjectId: string;
  name: string;
  description?: string;
  expectedEndDate?: string;
  createdByUserId?: string;
}

export async function createPhase(input: CreatePhaseInput): Promise<TmsProjectPhaseRecord | null> {
  if (!isUuid(input.tmsProjectId)) return null;
  // Appended to the end of the current order rather than defaulted to 0,
  // which would make every new phase sort first and silently reorder the
  // ones already there.
  const existing = await db.TmsProjectPhase.findAll({
    where: { tms_project_id: input.tmsProjectId } as never,
    attributes: ['sequence']
  });
  const nextSequence = existing.reduce((max, r) => Math.max(max, Number(r.get('sequence') ?? 0)), 0) + 1;

  const created = await db.TmsProjectPhase.create({
    tms_project_id: input.tmsProjectId,
    name: input.name.trim(),
    description: (input.description ?? '').trim(),
    expected_end_date: input.expectedEndDate || null,
    sequence: nextSequence,
    status: 'pending',
    created_by: input.createdByUserId || null
  } as never);

  const withAssoc = await db.TmsProjectPhase.findByPk(created.get('id') as string, { include: INCLUDES });
  return withAssoc ? toRecord(withAssoc) : null;
}

export interface UpdatePhaseInput {
  name?: string;
  description?: string;
  expectedEndDate?: string;
  sequence?: number;
  status?: TmsProjectPhaseStatus;
}

export async function updatePhase(id: string, patch: UpdatePhaseInput): Promise<TmsProjectPhaseRecord | null> {
  if (!isUuid(id)) return null;
  const row = await db.TmsProjectPhase.findByPk(id);
  if (!row) return null;

  const attrs: Record<string, unknown> = {};
  if (typeof patch.name === 'string' && patch.name.trim()) attrs.name = patch.name.trim();
  if (typeof patch.description === 'string') attrs.description = patch.description.trim();
  // '' clears the date rather than being ignored — a deadline set by mistake
  // has to be removable, not just changeable.
  if (patch.expectedEndDate !== undefined) attrs.expected_end_date = patch.expectedEndDate || null;
  if (typeof patch.sequence === 'number' && Number.isFinite(patch.sequence)) attrs.sequence = patch.sequence;
  if (patch.status) {
    attrs.status = patch.status;
    // Derived here, never accepted from the caller, so every path that
    // completes or reopens a phase gets the date right for free.
    if (patch.status !== (row.get('status') as string)) {
      attrs.completed_at = patch.status === 'completed' ? new Date().toISOString().slice(0, 10) : null;
    }
  }
  await row.update(attrs as never);

  const withAssoc = await db.TmsProjectPhase.findByPk(id, { include: INCLUDES });
  return withAssoc ? toRecord(withAssoc) : null;
}

export async function removePhase(id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const deleted = await db.TmsProjectPhase.destroy({ where: { id } as never });
  return deleted > 0;
}

export async function findPhaseById(id: string): Promise<TmsProjectPhaseRecord | null> {
  if (!isUuid(id)) return null;
  const row = await db.TmsProjectPhase.findByPk(id, { include: INCLUDES });
  return row ? toRecord(row) : null;
}
