import { db, isUuid } from './db';
import { MaterialCategory, isMaterialCategory } from './materialCategories';
import { PublishableFolder, PublishableMaterial, materialVisibleToPartner, partnerVisibleFolders } from './materialPublication';

// The partner-facing slice of the Materials library, plus the publication
// controls Marketing uses to decide what goes in it.
//
// Reads load the published candidates and then apply the two-gate rule from
// lib/materialPublication.ts in memory. That split is deliberate: the rule
// involves walking each document's folder chain to the root, which SQL
// expresses badly (a recursive CTE for a tree that is capped at five levels
// and a handful of rows), and keeping it in a pure function is what makes it
// testable at all.

export interface PartnerMaterial {
  id: string;
  folderId: string | null;
  product: string;
  category: MaterialCategory;
  title: string;
  description: string;
  webViewLink: string;
  isFolder: boolean;
  updatedAt: string;
}

export interface PartnerFolder {
  id: string;
  name: string;
  parentId: string | null;
}

function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

/**
 * Everything published to this partner, with the folder tree to browse it.
 *
 * Note the query loads only partner_visible rows to begin with — the
 * in-memory rule then narrows further. An unpublished document never leaves
 * the database, so a bug in the rule cannot expose one that was never a
 * candidate.
 */
export async function listPartnerMaterials(partnerId: string): Promise<{ materials: PartnerMaterial[]; folders: PartnerFolder[] }> {
  if (!isUuid(partnerId)) return { materials: [], folders: [] };

  const [materialRows, folderRows] = await Promise.all([
    db.Material.findAll({ where: { partner_visible: true } as never, order: [['product', 'ASC']] }),
    // Folders are NOT pre-filtered on partner_visible: the chain walk needs
    // every ancestor, including unpublished ones, to decide that a
    // descendant is blocked. Filtering here would silently make an
    // unpublished parent look absent rather than closed, and the chain would
    // then pass.
    db.MaterialFolder.findAll()
  ]);

  const folders: PublishableFolder[] = folderRows.map((row) => {
    const plain = row.get({ plain: true }) as Record<string, unknown>;
    return {
      id: plain.id as string,
      parentId: (plain.parent_id as string) ?? null,
      partnerVisible: plain.partner_visible === true
    };
  });

  const candidates = materialRows.map((row) => {
    const plain = row.get({ plain: true }) as Record<string, unknown>;
    const publishable: PublishableMaterial = {
      id: plain.id as string,
      folderId: (plain.folder_id as string) ?? null,
      partnerVisible: plain.partner_visible === true,
      partnerAudience: Array.isArray(plain.partner_audience) ? (plain.partner_audience as string[]) : []
    };
    const rawCategory = plain.category as string;
    const view: PartnerMaterial = {
      id: publishable.id,
      folderId: publishable.folderId,
      product: (plain.product as string) ?? '',
      category: isMaterialCategory(rawCategory) ? rawCategory : 'other',
      title: (plain.title as string) ?? '',
      description: (plain.description as string) ?? '',
      webViewLink: (plain.web_view_link as string) ?? '',
      isFolder: Boolean(plain.is_folder),
      updatedAt: isoOrEmpty(plain.updatedAt)
    };
    return { publishable, view };
  });

  const visible = candidates.filter((c) => materialVisibleToPartner(c.publishable, folders, partnerId));
  const treeFolders = partnerVisibleFolders(
    folders,
    visible.map((c) => c.publishable)
  );

  const folderById = new Map(folderRows.map((row) => [row.get('id') as string, row.get('name') as string]));

  return {
    materials: visible.map((c) => c.view),
    folders: treeFolders.map((f) => ({ id: f.id, name: folderById.get(f.id) ?? '', parentId: f.parentId }))
  };
}

/** Is this one document published to this partner? Gates the access log. */
export async function partnerCanOpenMaterial(partnerId: string, materialId: string): Promise<boolean> {
  if (!isUuid(partnerId) || !isUuid(materialId)) return false;
  const { materials } = await listPartnerMaterials(partnerId);
  return materials.some((m) => m.id === materialId);
}

/**
 * Record that someone opened a document.
 *
 * Fire-and-forget by convention, like logAudit and notifyUsers: a logging
 * failure must never stop someone reading a brochure.
 */
export async function logMaterialAccess(materialId: string, userId: string, partnerId: string | null, action: 'view' | 'download' = 'view'): Promise<void> {
  try {
    if (!isUuid(materialId)) return;
    await db.MaterialAccessLog.create({
      material_id: materialId,
      user_id: userId || null,
      partner_id: partnerId || null,
      action,
      at: new Date()
    } as never);
  } catch {
    // never block the read
  }
}

export interface MaterialAccessSummary {
  materialId: string;
  title: string;
  product: string;
  views: number;
  lastAccessedAt: string;
}

/** Usage rollup for Marketing — which published collateral partners actually open. */
export async function summariseMaterialAccess(): Promise<MaterialAccessSummary[]> {
  const rows = await db.MaterialAccessLog.findAll({
    include: [{ model: db.Material, as: 'material', attributes: ['id', 'title', 'product'], required: true }],
    order: [['at', 'DESC']],
    // Bounded: this is a dashboard panel, not an export. An unbounded read of
    // an append-only log grows without limit.
    limit: 2000
  });

  const summary = new Map<string, MaterialAccessSummary>();
  for (const row of rows) {
    const plain = row.get({ plain: true }) as Record<string, unknown>;
    const material = plain.material as { id?: string; title?: string; product?: string } | null;
    if (!material?.id) continue;
    const existing = summary.get(material.id);
    const at = isoOrEmpty(plain.at);
    if (existing) {
      existing.views++;
      if (at > existing.lastAccessedAt) existing.lastAccessedAt = at;
    } else {
      summary.set(material.id, {
        materialId: material.id,
        title: material.title ?? '',
        product: material.product ?? '',
        views: 1,
        lastAccessedAt: at
      });
    }
  }
  return [...summary.values()].sort((a, b) => b.views - a.views);
}

/** Marketing publishing or un-publishing a document. */
export async function setMaterialPublication(
  materialId: string,
  patch: { partnerVisible?: boolean; partnerAudience?: string[] },
  actorId: string
): Promise<boolean> {
  if (!isUuid(materialId)) return false;
  const row = await db.Material.findByPk(materialId);
  if (!row) return false;
  const attrs: Record<string, unknown> = { updated_by: actorId };
  if (patch.partnerVisible !== undefined) attrs.partner_visible = patch.partnerVisible;
  if (patch.partnerAudience !== undefined) attrs.partner_audience = patch.partnerAudience;
  await row.update(attrs as never);
  return true;
}

export async function setFolderPublication(folderId: string, partnerVisible: boolean, actorId: string): Promise<boolean> {
  if (!isUuid(folderId)) return false;
  const row = await db.MaterialFolder.findByPk(folderId);
  if (!row) return false;
  await row.update({ partner_visible: partnerVisible, updated_by: actorId } as never);
  return true;
}
