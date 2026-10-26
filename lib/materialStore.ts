import { Model, Op } from 'sequelize';
import { db, isUuid } from './db';
import { fileKindFromMime, isMaterialCategory, MaterialCategory, MaterialFileKind } from './materialCategories';

// The material library: what Marketing has published, and where it lives in
// Drive. MatrixIQ stores the LINK, never the file — so this table is small,
// and nothing here needs Google credentials.

// Which of the three "add a material" paths a row came from: a Google Drive
// link, a file uploaded into this app's own storage, or any other web address
// (a product video, a supplier's page, a Dropbox or OneDrive share).
export type MaterialSource = 'drive' | 'upload' | 'link';

const MATERIAL_SOURCES: readonly MaterialSource[] = ['drive', 'upload', 'link'];

export interface MaterialRecord {
  id: string;
  folderId: string | null;
  product: string;
  category: MaterialCategory;
  title: string;
  description: string;
  webViewLink: string;
  isFolder: boolean;
  source: MaterialSource;
  fileKind: MaterialFileKind;
  addedBy: string;
  updatedAt: string;
  /**
   * Whether this document is published to the Partner Portal.
   *
   * Only half the answer: a partner sees it only if every folder above it is
   * ALSO published — the two-gate rule in lib/materialPublication.ts. The
   * internal library surfaces this flag so the add/edit form can set it and
   * the card can warn when it is on but the folder chain is closed.
   */
  partnerVisible: boolean;
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
  const rawSource = plain.source as string;
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
    // Validated against the known set rather than collapsed with a ternary:
    // the two-way version of this line read `rawSource === 'upload' ? ... :
    // 'drive'`, which silently turned every future source into 'drive' — and
    // would have made a stored 'link' row come back claiming to be a Drive
    // link, so the edit form prefilled an external URL into the Drive field
    // and its own validation then refused to save it.
    source: MATERIAL_SOURCES.includes(rawSource as MaterialSource) ? (rawSource as MaterialSource) : 'drive',
    // An uploaded file carries its real content-type; a Drive link has none
    // to read, so the icon still has to come from the name the person typed.
    // A folder is its own kind regardless, and a web link is marked as one
    // rather than being guessed at from a title that may end in ".pdf".
    fileKind: plain.is_folder
      ? 'folder'
      : rawSource === 'link'
        ? 'link'
        : fileKindFromMime((plain.mime_type as string) || '', title),
    addedBy: creator?.name || creator?.username || '',
    updatedAt: isoOrEmpty(plain.updatedAt),
    partnerVisible: plain.partner_visible === true
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
  // Already parsed and normalised by lib/driveLink.ts or lib/customLink.ts —
  // the store never re-parses, so exactly one place decides what a valid link
  // is. Empty for an uploaded material and for a web link: neither has a
  // Drive id. It must stay empty for those, or the partial unique index on
  // drive_file_id starts rejecting two materials that point at one page.
  driveFileId: string;
  webViewLink: string;
  isFolder: boolean;
  source: MaterialSource;
  // The uploaded file's real content-type. Always '' for a Drive link and for
  // a web link — in neither case did anything here read the bytes, so any
  // content-type would be invented.
  mimeType: string;
  partnerVisible: boolean;
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
    source: input.source,
    mime_type: input.mimeType || null,
    partner_visible: input.partnerVisible === true,
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
  if (patch.partnerVisible !== undefined) attrs.partner_visible = patch.partnerVisible === true;
  if (patch.webViewLink !== undefined) {
    attrs.web_view_link = patch.webViewLink;
    attrs.drive_file_id = patch.driveFileId || null;
    attrs.is_folder = Boolean(patch.isFolder);
    // source/mime_type are a package deal with the link itself — changing
    // WHERE the material points has to also change WHAT KIND of pointer it
    // is, or an edit from upload back to a Drive link would leave the old
    // upload's mime_type and source:'upload' stale on a row that no longer
    // has an uploaded file behind it at all.
    // The 'drive' default is a floor, never a decision: every caller reaches
    // this through resolveMaterialLink, which always returns a source. If a
    // patch ever sets webViewLink without one, the row would end up holding
    // an external URL while claiming to be a Drive link — the exact state
    // that then fails to round-trip through the edit form.
    attrs.source = patch.source ?? 'drive';
    attrs.mime_type = patch.mimeType || null;
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
