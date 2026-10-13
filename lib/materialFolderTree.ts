// Folder-tree arithmetic for the Material library: building the tree, walking
// a breadcrumb back to the root, and the two rules that stop a tree from
// becoming something that isn't a tree.
//
// Pure — no DB. The store enforces these rules with real rows, and the tests
// exercise them here without a database.

export interface FolderNode {
  id: string;
  name: string;
  // null for a folder sitting at the top level.
  parentId: string | null;
}

// A folder nested this deep is almost certainly a mistake rather than an
// intent, and an unbounded tree makes every breadcrumb and move check
// unbounded too. Five levels is deeper than "Robots / Industrial / Arm /
// X200" ever needs to go.
export const MAX_FOLDER_DEPTH = 5;

export class FolderTreeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FolderTreeError';
  }
}

function byId(folders: FolderNode[]): Map<string, FolderNode> {
  return new Map(folders.map((folder) => [folder.id, folder]));
}

// Root-first path to a folder, e.g. [Robots, Industrial] for the folder
// "Industrial" inside "Robots" — which is exactly the breadcrumb.
//
// Defends against a cycle rather than trusting the data: a corrupt parent
// chain would otherwise hang the request in an infinite loop, and a hung
// page is far worse to diagnose than a short path.
export function folderPath(folders: FolderNode[], folderId: string | null): FolderNode[] {
  if (!folderId) return [];
  const lookup = byId(folders);
  const path: FolderNode[] = [];
  const seen = new Set<string>();

  let current = lookup.get(folderId) ?? null;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    current = current.parentId ? lookup.get(current.parentId) ?? null : null;
  }
  return path;
}

export function folderDepth(folders: FolderNode[], folderId: string | null): number {
  return folderPath(folders, folderId).length;
}

// Every folder below this one, at any depth — what "is this folder empty?"
// and "would this move make a cycle?" both need.
export function descendantIds(folders: FolderNode[], folderId: string): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const folder of folders) {
    if (!folder.parentId) continue;
    const list = childrenOf.get(folder.parentId);
    if (list) list.push(folder.id);
    else childrenOf.set(folder.parentId, [folder.id]);
  }

  const out = new Set<string>();
  const queue = [...(childrenOf.get(folderId) ?? [])];
  while (queue.length) {
    const id = queue.shift() as string;
    // A pre-existing cycle can't make this loop forever, because an id
    // already seen is never queued again.
    if (out.has(id)) continue;
    out.add(id);
    queue.push(...(childrenOf.get(id) ?? []));
  }
  return out;
}

export function directChildren(folders: FolderNode[], parentId: string | null): FolderNode[] {
  return folders
    .filter((folder) => (folder.parentId ?? null) === parentId)
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' }));
}

// The two rules that keep the tree a tree. Thrown as FolderTreeError so the
// API can turn each into a 400 with the message as written — these are
// explanations for a person, not internal errors.
export function assertCanMove(folders: FolderNode[], folderId: string, nextParentId: string | null): void {
  if (nextParentId === folderId) {
    throw new FolderTreeError('A folder can’t be moved inside itself.');
  }

  // Moving a folder into its own descendant would detach that whole branch
  // from the root — it would still exist, but nothing could ever navigate to
  // it again.
  if (nextParentId && descendantIds(folders, folderId).has(nextParentId)) {
    throw new FolderTreeError('A folder can’t be moved inside one of its own subfolders.');
  }

  // The moved folder brings its own subtree with it, so the check is against
  // the deepest leaf under it, not just the folder itself.
  const subtreeHeight = heightOf(folders, folderId);
  const nextDepth = folderDepth(folders, nextParentId) + 1 + subtreeHeight;
  if (nextDepth > MAX_FOLDER_DEPTH) {
    throw new FolderTreeError(`Folders can only be ${MAX_FOLDER_DEPTH} levels deep.`);
  }
}

export function assertCanCreate(folders: FolderNode[], parentId: string | null): void {
  if (folderDepth(folders, parentId) + 1 > MAX_FOLDER_DEPTH) {
    throw new FolderTreeError(`Folders can only be ${MAX_FOLDER_DEPTH} levels deep.`);
  }
}

// How many levels sit BELOW this folder. 0 for a folder with no subfolders.
function heightOf(folders: FolderNode[], folderId: string): number {
  const children = directChildren(folders, folderId);
  if (!children.length) return 0;
  return 1 + Math.max(...children.map((child) => heightOf(folders, child.id)));
}

// Two folders with the same name under the same parent are indistinguishable
// once the page is rendered, so the name has to be unique among siblings —
// case-insensitively, since "Robots" and "robots" read as the same folder.
export function hasSiblingNamed(folders: FolderNode[], parentId: string | null, name: string, exceptId?: string): boolean {
  const target = name.trim().toLowerCase();
  return folders.some(
    (folder) =>
      folder.id !== exceptId &&
      (folder.parentId ?? null) === (parentId ?? null) &&
      folder.name.trim().toLowerCase() === target
  );
}
