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

export function isCelebrationCategory(value: unknown): value is CelebrationCategory {
  return typeof value === 'string' && (CELEBRATION_CATEGORIES as readonly string[]).includes(value);
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
  category: CelebrationCategory;
  subfolder: string;
  title: string;
  description: string;
  fileUrl: string;
  mimeType: string;
  kind: CelebrationMediaKind;
  addedBy: string;
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
  const rawCategory = plain.category as string;
  const mimeType = (plain.mime_type as string) ?? '';
  return {
    id: plain.id as string,
    category: isCelebrationCategory(rawCategory) ? rawCategory : 'event_expo',
    subfolder: (plain.subfolder as string) ?? '',
    title: (plain.title as string) ?? '',
    description: (plain.description as string) ?? '',
    fileUrl: (plain.file_url as string) ?? '',
    mimeType,
    kind: celebrationMediaKind(mimeType),
    addedBy: creator?.name || creator?.username || '',
    createdAt: isoOrEmpty(plain.created_at ?? plain.createdAt)
  };
}

export interface ListCelebrationFilters {
  category?: CelebrationCategory;
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
export async function listSubfolders(category: CelebrationCategory): Promise<SubfolderSummary[]> {
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
  category: CelebrationCategory;
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
