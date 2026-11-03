import { Model } from 'sequelize';
import { db, isUuid } from './db';
import {
  assertCanCreate,
  assertCanMove,
  descendantIds,
  directChildren,
  FolderNode,
  folderPath,
  FolderTreeError,
  hasSiblingNamed
} from './materialFolderTree';
import { folderChainAllowsRole, roleAllows, RoleScopedFolder } from './materialRoleVisibility';

// Folders in the Material library — MatrixIQ's own structure for the
// collateral, not a mirror of anything in Drive.
//
// Every rule that keeps the tree a tree lives in lib/materialFolderTree.ts
// and is applied here against the real rows. The schema can't express "no
// cycles" or "at most five deep", so this is the only place they hold.

export interface MaterialFolderRecord {
  id: string;
  name: string;
  parentId: string | null;
  description: string;
  // Direct children only — what the folder grid shows as subfolders.
  subfolderCount: number;
  // Materials sitting directly in this folder.
  materialCount: number;
  updatedAt: string;
  /**
   * Whether this folder is open to partners.
   *
   * The SECOND gate of lib/materialPublication.ts: a published document
   * inside a closed folder stays hidden, and so does a published folder
   * inside a closed one. Surfaced here so the internal grid can show the
   * state and explain why a shared document is not reaching anyone.
   */
  partnerVisible: boolean;
  /**
   * Which internal roles may browse this folder.
   *
   * [] = every internal role, the library's historical behaviour. A
   * populated array narrows this folder AND everything inside it — the
   * folder is a containing boundary, exactly as it is for partnerVisible.
   */
  visibleToRoles: string[];
}

export { FolderTreeError };

function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

function toNode(row: Model): FolderNode {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  return {
    id: plain.id as string,
    name: (plain.name as string) ?? '',
    parentId: (plain.parent_id as string) ?? null
  };
}

async function allFolderRows(): Promise<Model[]> {
  return db.MaterialFolder.findAll({ order: [['name', 'ASC']] });
}

// The whole tree, every time. It's a handful of rows — a marketing library
// has tens of folders, not thousands — and having all of them in hand is
// what lets the depth, cycle and duplicate-name checks run without a
// recursive query.
async function allNodes(): Promise<FolderNode[]> {
  return (await allFolderRows()).map(toNode);
}

export async function listFolderTree(): Promise<FolderNode[]> {
  return allNodes();
}

/**
 * Who is looking, for the role gate in lib/materialRoleVisibility.ts.
 *
 * Passed into the read functions rather than applied by each route, because
 * the gate has to hold for every caller — a filter written at the route
 * level is the one that gets forgotten on the next route. Omitting the scope
 * means "no gate", which is what the management and partner paths want:
 * partner visibility is a separate, already-central rule, and a curator sees
 * the whole library on purpose (see seesEveryRole).
 */
export interface RoleScope {
  role: string;
  /** True for superadmin and for whoever may manage materials. */
  seesEverything: boolean;
}

/** The whole tree with each folder's role list — what the chain walk needs. */
export async function listRoleScopedFolders(): Promise<RoleScopedFolder[]> {
  return (await allFolderRows()).map(toRoleScoped);
}

function toRoleScoped(row: Model): RoleScopedFolder {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  return {
    id: plain.id as string,
    parentId: (plain.parent_id as string) ?? null,
    visibleToRoles: toRoleList(plain.visible_to_roles)
  };
}

/** Whatever JSONB came back, as a clean list of role keys. */
export function toRoleList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '');
}

/** Does this scope admit this folder? A null folder is the top level. */
export async function isFolderVisibleToScope(folderId: string | null, scope?: RoleScope): Promise<boolean> {
  if (!folderId || !scope || scope.seesEverything) return true;
  return folderChainAllowsRole(await listRoleScopedFolders(), folderId, scope.role);
}

// The breadcrumb for a folder, root first.
/**
 * A crumb carries the folder's publication state as well as its name.
 *
 * The breadcrumb IS the folder chain, which is precisely what the second
 * gate of lib/materialPublication.ts walks. Returning partnerVisible on each
 * crumb lets the internal library answer "would a partner actually see
 * anything I put here?" without a second round trip or a reimplementation of
 * the rule in the browser.
 */
export interface BreadcrumbFolder extends FolderNode {
  partnerVisible: boolean;
  /** [] = every internal role — the same meaning as on the folder itself. */
  visibleToRoles: string[];
}

export async function folderBreadcrumb(folderId: string | null): Promise<BreadcrumbFolder[]> {
  // The top level is not a folder and cannot be un-published — an empty
  // breadcrumb therefore means "no chain to close", matching
  // folderChainPublished's treatment of a null folderId.
  if (!folderId) return [];
  const rows = await allFolderRows();
  const byId = new Map(rows.map((row) => [row.get('id') as string, row]));
  return folderPath(rows.map(toNode), folderId).map((node) => {
    const plain = (byId.get(node.id)?.get({ plain: true }) ?? {}) as Record<string, unknown>;
    return {
      ...node,
      partnerVisible: plain.partner_visible === true,
      visibleToRoles: toRoleList(plain.visible_to_roles)
    };
  });
}

// The subfolders shown inside one folder, each with the counts that tell
// somebody whether it's worth opening.
export async function listSubfolders(parentId: string | null, scope?: RoleScope): Promise<MaterialFolderRecord[]> {
  const rows = await allFolderRows();
  const nodes = rows.map(toNode);
  const byIdForScope = new Map(rows.map((row) => [row.get('id') as string, toRoleList(row.get('visible_to_roles'))]));
  let children = directChildren(nodes, parentId);
  // Only the children's OWN lists are checked here, not the whole chain: to
  // be standing in `parentId` at all you already passed every gate above it
  // (the route checks that with isFolderVisibleToScope), so re-walking the
  // ancestors would be work that can only reach the same answer.
  if (scope && !scope.seesEverything) {
    children = children.filter((child) => roleAllows(byIdForScope.get(child.id), scope.role));
  }
  if (!children.length) return [];

  const byId = new Map(rows.map((row) => [row.get('id') as string, row]));

  // Two grouped counts for the whole level rather than two queries per
  // folder — a folder grid would otherwise cost 2N round trips.
  const childIds = children.map((child) => child.id);
  const [materialCounts, subfolderCounts] = await Promise.all([
    db.Material.findAll({
      attributes: ['folder_id', [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'count']],
      where: { folder_id: childIds } as never,
      group: ['folder_id']
    }),
    db.MaterialFolder.findAll({
      attributes: ['parent_id', [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'count']],
      where: { parent_id: childIds } as never,
      group: ['parent_id']
    })
  ]);

  const materialCountBy = new Map(materialCounts.map((r) => [String(r.get('folder_id')), Number(r.get('count')) || 0]));
  const subfolderCountBy = new Map(subfolderCounts.map((r) => [String(r.get('parent_id')), Number(r.get('count')) || 0]));

  return children.map((child) => {
    const row = byId.get(child.id);
    const plain = row ? (row.get({ plain: true }) as Record<string, unknown>) : {};
    return {
      id: child.id,
      name: child.name,
      parentId: child.parentId,
      description: (plain.description as string) ?? '',
      subfolderCount: subfolderCountBy.get(child.id) ?? 0,
      materialCount: materialCountBy.get(child.id) ?? 0,
      updatedAt: isoOrEmpty(plain.updatedAt),
      partnerVisible: plain.partner_visible === true,
      visibleToRoles: toRoleList(plain.visible_to_roles)
    };
  });
}

export async function findFolderById(id: string): Promise<FolderNode | undefined> {
  if (!isUuid(id)) return undefined;
  const row = await db.MaterialFolder.findByPk(id);
  return row ? toNode(row) : undefined;
}

export interface CreateFolderInput {
  name: string;
  parentId: string | null;
  description?: string;
  partnerVisible?: boolean;
  /** [] or omitted = every internal role. See lib/materialRoleVisibility.ts. */
  visibleToRoles?: string[];
  actorId: string;
}

export async function createFolder(input: CreateFolderInput): Promise<FolderNode> {
  const name = input.name.trim();
  if (!name) throw new FolderTreeError('Give the folder a name.');

  const nodes = await allNodes();
  if (input.parentId && !nodes.some((node) => node.id === input.parentId)) {
    throw new FolderTreeError('That parent folder no longer exists.');
  }
  assertCanCreate(nodes, input.parentId);
  if (hasSiblingNamed(nodes, input.parentId, name)) {
    throw new FolderTreeError(`There’s already a folder called “${name}” here.`);
  }

  const row = await db.MaterialFolder.create({
    name,
    parent_id: input.parentId,
    description: input.description ?? '',
    // Opt-in, same as a document. A new folder is internal until someone
    // says otherwise.
    partner_visible: input.partnerVisible === true,
    // Unrestricted unless asked for, so adding a folder never quietly hides
    // it from the company.
    visible_to_roles: toRoleList(input.visibleToRoles),
    created_by: input.actorId || null,
    updated_by: input.actorId || null
  } as never);
  return toNode(row);
}

export interface UpdateFolderInput {
  name?: string;
  // undefined = don't move it. null = move it to the top level — which is
  // why this can't just be a falsy check.
  parentId?: string | null;
  description?: string;
  partnerVisible?: boolean;
  /** [] = open it back up to every internal role. */
  visibleToRoles?: string[];
  actorId: string;
}

export async function updateFolder(id: string, patch: UpdateFolderInput): Promise<FolderNode | undefined> {
  if (!isUuid(id)) return undefined;
  const row = await db.MaterialFolder.findByPk(id);
  if (!row) return undefined;

  const nodes = await allNodes();
  const current = toNode(row);
  const nextParentId = patch.parentId === undefined ? current.parentId : patch.parentId;
  const nextName = patch.name === undefined ? current.name : patch.name.trim();

  if (!nextName) throw new FolderTreeError('Give the folder a name.');
  if (patch.parentId !== undefined && patch.parentId !== current.parentId) {
    if (patch.parentId && !nodes.some((node) => node.id === patch.parentId)) {
      throw new FolderTreeError('That folder no longer exists.');
    }
    assertCanMove(nodes, id, patch.parentId);
  }
  if (hasSiblingNamed(nodes, nextParentId, nextName, id)) {
    throw new FolderTreeError(`There’s already a folder called “${nextName}” here.`);
  }

  const attrs: Record<string, unknown> = { updated_by: patch.actorId || null };
  if (patch.name !== undefined) attrs.name = nextName;
  if (patch.parentId !== undefined) attrs.parent_id = patch.parentId;
  if (patch.description !== undefined) attrs.description = patch.description;
  if (patch.partnerVisible !== undefined) attrs.partner_visible = patch.partnerVisible === true;
  if (patch.visibleToRoles !== undefined) attrs.visible_to_roles = toRoleList(patch.visibleToRoles);

  await row.update(attrs as never);
  return toNode(row);
}

export interface FolderContents {
  subfolders: number;
  materials: number;
}

// What's inside a folder, counting the whole subtree — what the delete
// refusal reports, since "empty" has to mean empty all the way down.
export async function folderContents(id: string): Promise<FolderContents> {
  const nodes = await allNodes();
  const subtree = descendantIds(nodes, id);
  const materials = await db.Material.count({ where: { folder_id: [id, ...subtree] } as never });
  return { subfolders: subtree.size, materials };
}

// Deleting is refused unless the folder is empty all the way down. The
// alternative — cascading — would quietly take a whole branch of somebody's
// library with one click, and the FK is RESTRICT precisely so a bug here
// can't do it either.
export async function deleteFolder(id: string): Promise<void> {
  if (!isUuid(id)) throw new FolderTreeError('Folder not found.');
  const row = await db.MaterialFolder.findByPk(id);
  if (!row) throw new FolderTreeError('Folder not found.');

  const contents = await folderContents(id);
  if (contents.materials || contents.subfolders) {
    const parts: string[] = [];
    if (contents.subfolders) parts.push(`${contents.subfolders} folder${contents.subfolders === 1 ? '' : 's'}`);
    if (contents.materials) parts.push(`${contents.materials} material${contents.materials === 1 ? '' : 's'}`);
    throw new FolderTreeError(`This folder still holds ${parts.join(' and ')}. Move or remove them first.`);
  }

  await row.destroy();
}
