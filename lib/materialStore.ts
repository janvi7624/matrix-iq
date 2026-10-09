import { Model, Op } from 'sequelize';
import { db, isUuid } from './db';
import { fileKindFromMime, isMaterialCategory, MaterialCategory, MaterialFileKind } from './materialCategories';

// The material library: what Marketing has published, and where it lives in
// Drive. MatrixIQ stores the LINK, never the file — so this table is small,
// and nothing here needs Google credentials.

export interface MaterialRecord {
  id: string;
  folderId: string | null;
  product: string;
  category: MaterialCategory;
  title: string;
  description: string;
  webViewLink: string;
  isFolder: boolean;
  fileKind: MaterialFileKind;
  addedBy: string;
  updatedAt: string;
}

const INCLUDE_PEOPLE = [{ model: db.User, as: 'creator', attributes: ['id', 'name', 'username'] }];

function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

function toRecord(row: Model): MaterialRecord {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const creator = plain.creator as { name?: string; username?: string } | null;
  const title = (plain.title as string) ?? '';
  const rawCategory = plain.category as string;
  return {
    id: plain.id as string,
    folderId: (plain.folder_id as string) ?? null,
    product: (plain.product as string) ?? '',
    // A row whose category was retired still reads as something valid rather
    // than breaking the filter tabs.
    category: isMaterialCategory(rawCategory) ? rawCategory : 'other',
    title,
    description: (plain.description as string) ?? '',
    webViewLink: (plain.web_view_link as string) ?? '',
    isFolder: Boolean(plain.is_folder),
    // No mime type is stored — nothing reads the file — so the icon comes
    // from the name the person typed. A folder is its own kind.
    fileKind: plain.is_folder ? 'folder' : fileKindFromMime('', title),
    addedBy: creator?.name || creator?.username || '',
    updatedAt: isoOrEmpty(plain.updatedAt)
  };
}

export interface ListMaterialsFilters {
  category?: MaterialCategory;
  // Matched against product, document name and description — "X200" has to
  // find it whichever of those the words actually live in.
  search?: string;
  // Which folder to look inside. `null` means the library's top level, which
  // is a real place with its own contents — so "don't filter by folder at
  // all" has to be the separate `anyFolder` flag rather than a falsy value.
  folderId?: string | null;
  anyFolder?: boolean;
}

export async function listMaterials(filters: ListMaterialsFilters = {}): Promise<MaterialRecord[]> {
  const where: Record<string | symbol, unknown> = {};
  if (filters.category) where.category = filters.category;
  // Searching deliberately ignores folders (anyFolder) — someone looking for
  // "X200" wants it found wherever it was filed, not only in the folder they
  // happen to be standing in.
  if (!filters.anyFolder) where.folder_id = filters.folderId ?? null;

  const search = (filters.search ?? '').trim();
  if (search) {
    const like = { [Op.iLike]: `%${search}%` };
    where[Op.or as unknown as string] = [{ product: like }, { title: like }, { description: like }];
  }

  const rows = await db.Material.findAll({
    where: where as never,
    include: INCLUDE_PEOPLE as never,
    // Product A-Z within a category: the library is browsed as a product
    // list and people scan it alphabetically. Title then orders the
    // documents inside one product.
    order: [
      ['category', 'ASC'],
      ['product', 'ASC'],
      ['title', 'ASC']
    ]
  });
  return rows.map(toRecord);
}

export async function findMaterialById(id: string): Promise<MaterialRecord | undefined> {
  if (!isUuid(id)) return undefined;
  const row = await db.Material.findByPk(id, { include: INCLUDE_PEOPLE as never });
  return row ? toRecord(row) : undefined;
}

export interface MaterialInput {
  folderId: string | null;
  product: string;
  category: MaterialCategory;
  title: string;
  description: string;
  // Already parsed and normalised by lib/driveLink.ts — the store never
  // re-parses, so exactly one place decides what a valid link is.
  driveFileId: string;
  webViewLink: string;
  isFolder: boolean;
  actorId: string;
}

export async function createMaterial(input: MaterialInput): Promise<MaterialRecord> {
  const row = await db.Material.create({
    folder_id: input.folderId,
    product: input.product,
    category: input.category,
    title: input.title || input.product,
    description: input.description,
    // Null when the pasted URL had no parseable id. Postgres allows any
    // number of NULLs under the partial unique index, so these never collide.
    drive_file_id: input.driveFileId || null,
    web_view_link: input.webViewLink,
    is_folder: input.isFolder,
    created_by: input.actorId || null,
    updated_by: input.actorId || null
  } as never);
  const withAssoc = await db.Material.findByPk(row.get('id') as string, { include: INCLUDE_PEOPLE as never });
  return toRecord(withAssoc as Model);
}

export type MaterialPatch = Partial<Omit<MaterialInput, 'actorId'>> & { actorId: string };

export async function updateMaterial(id: string, patch: MaterialPatch): Promise<MaterialRecord | undefined> {
  if (!isUuid(id)) return undefined;
  const row = await db.Material.findByPk(id);
  if (!row) return undefined;

  const attrs: Record<string, unknown> = { updated_by: patch.actorId || null };
  // Present-but-null is a real instruction — "move it to the top level" —
  // so this checks for the key, not for a truthy value.
  if (patch.folderId !== undefined) attrs.folder_id = patch.folderId;
  if (patch.product !== undefined) attrs.product = patch.product;
  if (patch.category !== undefined) attrs.category = patch.category;
  if (patch.title !== undefined) attrs.title = patch.title;
  if (patch.description !== undefined) attrs.description = patch.description;
  if (patch.webViewLink !== undefined) {
    attrs.web_view_link = patch.webViewLink;
    attrs.drive_file_id = patch.driveFileId || null;
    attrs.is_folder = Boolean(patch.isFolder);
  }

  await row.update(attrs as never);
  const withAssoc = await db.Material.findByPk(id, { include: INCLUDE_PEOPLE as never });
  return toRecord(withAssoc as Model);
}

export async function deleteMaterial(id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const row = await db.Material.findByPk(id);
  if (!row) return false;
  await row.destroy();
  return true;
}

// Every distinct product already in the library, for the add form's
// suggestions — so a second datasheet for "Allbotix X200" is filed under
// that exact name rather than "X200" or "Allbotix-X200", which would split
// one product across three rows.
export async function listProductNames(): Promise<string[]> {
  const rows = await db.Material.findAll({ attributes: ['product'], group: ['product'], order: [['product', 'ASC']] });
  return rows.map((row) => String(row.get('product') ?? '')).filter(Boolean);
}
