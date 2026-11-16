import { Model } from 'sequelize';
import { db, isUuid } from './db';

// Company Celebration (HR) — see the 20261114140000 migration for the shape.
// Only HR Manager may write (enforced by the API routes via isHrManager);
// every employee may read, same visibility as the rest of the HR Celebration
// wall.

export const CELEBRATION_CATEGORIES = [
  'birthday',
  'anniversary',
  'event_expo',
  'festival',
  'engagement_activities',
  'company_announcements',
  'employee_appreciation'
] as const;

export type CelebrationCategory = (typeof CELEBRATION_CATEGORIES)[number];

export const CELEBRATION_CATEGORY_LABEL: Record<CelebrationCategory, string> = {
  birthday: 'Birthday',
  anniversary: 'Anniversary',
  event_expo: 'Event / Expo',
  festival: 'Festival',
  engagement_activities: 'Engagement Activities',
  company_announcements: 'Company Announcements',
  employee_appreciation: 'Employee Appreciation'
};

export function isFixedCelebrationCategory(value: unknown): value is CelebrationCategory {
  return typeof value === 'string' && (CELEBRATION_CATEGORIES as readonly string[]).includes(value);
}

// Kept for existing callers — the fixed-list check alone. Custom categories
// (below) widen what's actually ACCEPTED when creating an item; this stays
// the "is one of the seven built-in ones" check used for icon/placeholder
// lookups, where a custom category has no special-cased entry anyway.
export const isCelebrationCategory = isFixedCelebrationCategory;

export interface CelebrationCategoryInfo {
  key: string;
  label: string;
  isCustom: boolean;
  /** A single emoji HR picked for a custom folder. Empty for the fixed seven, which use their own built-in icon instead. */
  icon?: string;
}

function slugifyCategory(label: string): string {
  return (
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 48) || 'folder'
  );
}

/** The fixed seven, in order, as {key,label}. */
export function listFixedCategories(): CelebrationCategoryInfo[] {
  return CELEBRATION_CATEGORIES.map((key) => ({ key, label: CELEBRATION_CATEGORY_LABEL[key], isCustom: false }));
}

// A row in company_celebration_categories whose key is one of the fixed
// seven is not a custom folder — it is HR's override of that built-in one
// (renamed label, chosen emoji, or hidden=true once HR deleted it).
async function allCategoryRows(): Promise<Record<string, unknown>[]> {
  const rows = await db.CompanyCelebrationCategory.findAll({ order: [['created_at', 'ASC']] });
  return rows.map((row) => row.get({ plain: true }) as Record<string, unknown>);
}

/** Extra top-level folders HR added beyond the fixed seven. */
export async function listCustomCategories(): Promise<CelebrationCategoryInfo[]> {
  return (await allCategoryRows())
    .filter((plain) => !isFixedCelebrationCategory(plain.key))
    .map((plain) => ({ key: plain.key as string, label: (plain.label as string) ?? '', isCustom: true, icon: (plain.icon as string) || '' }));
}

/** Every category this wall currently has, fixed ones first (with HR's overrides applied, deleted ones left out). */
export async function listAllCategories(): Promise<CelebrationCategoryInfo[]> {
  const rows = await allCategoryRows();
  const overrides = new Map(rows.filter((r) => isFixedCelebrationCategory(r.key)).map((r) => [r.key as string, r]));
  const fixed = listFixedCategories()
    .filter((c) => overrides.get(c.key)?.hidden !== true)
    .map((c) => {
      const o = overrides.get(c.key);
      return o ? { ...c, label: (o.label as string) || c.label, icon: (o.icon as string) || '' } : c;
    });
  return [...fixed, ...(await listCustomCategories())];
}

/** Whether `key` is a live (not deleted) fixed category or an existing custom one — what createCelebrationItem must accept. */
export async function isKnownCelebrationCategory(key: unknown): Promise<boolean> {
  if (typeof key !== 'string' || !key) return false;
  const row = await db.CompanyCelebrationCategory.findOne({ where: { key } as never });
  if (isFixedCelebrationCategory(key)) return (row?.get('hidden') as boolean | undefined) !== true;
  return !!row;
}

export interface CreateCustomCategoryInput {
  label: string;
  /** A single emoji, e.g. '🎉' — optional; falls back to the generic folder icon when empty. */
  icon?: string;
  actorId: string;
}

// A generous but finite cap, not a strict "exactly one emoji" validator —
// real emoji can be multiple UTF-16 code units (skin tone modifiers, ZWJ
// sequences like family/flag emoji), and rejecting those would punish
// perfectly normal picks. This only guards against someone pasting a whole
// sentence into the field; the column itself is STRING(8).
const MAX_ICON_LENGTH = 8;

export async function createCustomCategory(input: CreateCustomCategoryInput): Promise<CelebrationCategoryInfo> {
  const label = input.label.trim();
  if (!label) throw new Error('Give this folder a name.');
  const icon = (input.icon || '').trim().slice(0, MAX_ICON_LENGTH);

  const base = slugifyCategory(label);
  // Never collide with a fixed category's own key, and never with another
  // custom one — appending a numeric suffix the same way material folders'
  // sibling-name check does, just against a flat key list instead of a tree.
  const existingKeys = new Set([
    ...(CELEBRATION_CATEGORIES as readonly string[]),
    ...(await listCustomCategories()).map((c) => c.key)
  ]);
  let key = base;
  let suffix = 2;
  while (existingKeys.has(key)) {
    key = `${base}_${suffix}`;
    suffix += 1;
  }

  const row = await db.CompanyCelebrationCategory.create({
    key,
    label,
    icon: icon || null,
    created_by: input.actorId || null
  } as never);
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  return { key: plain.key as string, label: plain.label as string, isCustom: true, icon: (plain.icon as string) || '' };
}

export type CelebrationMediaKind = 'image' | 'video' | 'file';

export function celebrationMediaKind(mimeType: string): CelebrationMediaKind {
  const mime = (mimeType || '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  return 'file';
}

export interface CelebrationItemRecord {
  id: string;
  // A fixed key, or a custom one from CompanyCelebrationCategory — plain
  // string now that folders aren't limited to the built-in seven.
  category: string;
  subfolder: string;
  title: string;
  description: string;
  fileUrl: string;
  mimeType: string;
  kind: CelebrationMediaKind;
  addedBy: string;
  // The uploader's user id — not just their display name — so the API can
  // tell a contributor's OWN items apart from everyone else's for the
  // edit/delete ownership check (see isCelebrationContributor's comment).
  createdById: string;
  createdAt: string;
}

const INCLUDE_CREATOR = [{ model: db.User, as: 'creator', attributes: ['id', 'name', 'username'] }];

function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

function toRecord(row: Model): CelebrationItemRecord {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const creator = plain.creator as { name?: string; username?: string } | null;
  const mimeType = (plain.mime_type as string) ?? '';
  return {
    id: plain.id as string,
    category: (plain.category as string) ?? '',
    subfolder: (plain.subfolder as string) ?? '',
    title: (plain.title as string) ?? '',
    description: (plain.description as string) ?? '',
    fileUrl: (plain.file_url as string) ?? '',
    mimeType,
    kind: celebrationMediaKind(mimeType),
    addedBy: creator?.name || creator?.username || '',
    createdById: (plain.created_by as string) ?? '',
    createdAt: isoOrEmpty(plain.created_at ?? plain.createdAt)
  };
}

export async function findCelebrationItem(id: string): Promise<CelebrationItemRecord | null> {
  if (!isUuid(id)) return null;
  const row = await db.CompanyCelebration.findByPk(id, { include: INCLUDE_CREATOR as never });
  return row ? toRecord(row) : null;
}

export interface ListCelebrationFilters {
  category?: string;
  subfolder?: string;
}

export async function listCelebrationItems(filters: ListCelebrationFilters = {}): Promise<CelebrationItemRecord[]> {
  const where: Record<string, unknown> = {};
  if (filters.category) where.category = filters.category;
  if (filters.subfolder) where.subfolder = filters.subfolder;

  const rows = await db.CompanyCelebration.findAll({
    where: where as never,
    include: INCLUDE_CREATOR as never,
    order: [['created_at', 'DESC']]
  });
  return rows.map(toRecord);
}

export interface SubfolderSummary {
  name: string;
  itemCount: number;
  coverUrl: string;
  coverKind: CelebrationMediaKind;
  updatedAt: string;
}

// The subfolder grid shown inside one category — grouped in memory rather
// than SQL GROUP BY, because the "cover" (most recent item) needs the whole
// row, not just a count, and this table stays small (a company's celebration
// wall is tens to low hundreds of rows, not millions).
export async function listSubfolders(category: string): Promise<SubfolderSummary[]> {
  const items = await listCelebrationItems({ category });
  const bySubfolder = new Map<string, CelebrationItemRecord[]>();
  for (const item of items) {
    const list = bySubfolder.get(item.subfolder) ?? [];
    list.push(item);
    bySubfolder.set(item.subfolder, list);
  }
  const summaries: SubfolderSummary[] = [];
  for (const [name, list] of bySubfolder) {
    // Already ordered DESC by created_at from listCelebrationItems, so the
    // first entry for this subfolder is the most recent upload.
    const cover = list[0];
    summaries.push({
      name,
      itemCount: list.length,
      coverUrl: cover.fileUrl,
      coverKind: cover.kind,
      updatedAt: cover.createdAt
    });
  }
  return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export interface CreateCelebrationItemInput {
  category: string;
  subfolder: string;
  title: string;
  description: string;
  fileUrl: string;
  mimeType: string;
  actorId: string;
}

export async function createCelebrationItem(input: CreateCelebrationItemInput): Promise<CelebrationItemRecord> {
  const row = await db.CompanyCelebration.create({
    category: input.category,
    subfolder: input.subfolder.trim(),
    title: input.title.trim(),
    description: input.description.trim(),
    file_url: input.fileUrl,
    mime_type: input.mimeType || null,
    created_by: input.actorId || null
  } as never);
  const withAssoc = await db.CompanyCelebration.findByPk(row.get('id') as string, { include: INCLUDE_CREATOR as never });
  return toRecord(withAssoc as Model);
}

export async function deleteCelebrationItem(id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const row = await db.CompanyCelebration.findByPk(id);
  if (!row) return false;
  await row.destroy();
  return true;
}

// ---------- Edit / delete (HR Manager, admin, superadmin — gated by the routes) ----------

export async function updateCelebrationItem(id: string, patch: { title?: string; description?: string }): Promise<CelebrationItemRecord | null> {
  if (!isUuid(id)) return null;
  const row = await db.CompanyCelebration.findByPk(id);
  if (!row) return null;
  const changes: Record<string, string> = {};
  if (typeof patch.title === 'string') changes.title = patch.title.trim().slice(0, 200);
  if (typeof patch.description === 'string') changes.description = patch.description.trim().slice(0, 2000);
  await row.update(changes as never);
  const withAssoc = await db.CompanyCelebration.findByPk(id, { include: INCLUDE_CREATOR as never });
  return toRecord(withAssoc as Model);
}

/** Rename an album. Merges into the target if an album with that name already exists. Returns rows moved. */
export async function renameSubfolder(category: string, from: string, to: string): Promise<number> {
  const name = to.trim();
  if (!name) throw new Error('Give this album a name.');
  const [count] = await db.CompanyCelebration.update({ subfolder: name } as never, { where: { category, subfolder: from } as never });
  return count;
}

/** Delete an album and every photo/video in it. Returns rows removed. */
export async function deleteSubfolder(category: string, subfolder: string): Promise<number> {
  return db.CompanyCelebration.destroy({ where: { category, subfolder } as never });
}

/** Rename / re-icon any folder. For a built-in one this creates (or updates) its override row. */
export async function updateCustomCategory(key: string, patch: { label?: string; icon?: string }): Promise<CelebrationCategoryInfo | null> {
  let row = await db.CompanyCelebrationCategory.findOne({ where: { key } as never });
  if (!row) {
    if (!isFixedCelebrationCategory(key)) return null;
    // findOne + create, never findOrCreate — this DB role has no TEMP privilege.
    row = await db.CompanyCelebrationCategory.create({ key, label: CELEBRATION_CATEGORY_LABEL[key] } as never);
  }
  if (isFixedCelebrationCategory(key) && row.get('hidden') === true) return null;
  const changes: Record<string, unknown> = {};
  if (typeof patch.label === 'string') {
    const label = patch.label.trim();
    if (!label) throw new Error('Give this folder a name.');
    changes.label = label;
  }
  if (typeof patch.icon === 'string') changes.icon = patch.icon.trim().slice(0, MAX_ICON_LENGTH) || null;
  await row.update(changes as never);
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  return { key: plain.key as string, label: plain.label as string, isCustom: !isFixedCelebrationCategory(key), icon: (plain.icon as string) || '' };
}

/**
 * Delete a folder together with all of its albums and media. A built-in
 * folder's name lives in code, so "deleting" it marks its override row
 * hidden instead of removing a row that may not exist.
 */
export async function deleteCustomCategory(key: string): Promise<boolean> {
  const row = await db.CompanyCelebrationCategory.findOne({ where: { key } as never });
  if (isFixedCelebrationCategory(key)) {
    if (row?.get('hidden') === true) return false;
    await db.sequelize.transaction(async (transaction) => {
      await db.CompanyCelebration.destroy({ where: { category: key } as never, transaction });
      if (row) await row.update({ hidden: true } as never, { transaction });
      else await db.CompanyCelebrationCategory.create({ key, label: CELEBRATION_CATEGORY_LABEL[key], hidden: true } as never, { transaction });
    });
    return true;
  }
  if (!row) return false;
  await db.sequelize.transaction(async (transaction) => {
    await db.CompanyCelebration.destroy({ where: { category: key } as never, transaction });
    await row.destroy({ transaction });
  });
  return true;
}
