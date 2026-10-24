// Which marketing collateral a given partner may see.
//
// Pure, no imports — the whole rule is expressible over plain data, and it
// is the kind of rule that must be directly testable: a mistake here
// publishes internal sales decks and competitor comparisons to external
// companies.
//
// THE TWO-GATE RULE
// A document is visible to a partner only if BOTH hold:
//   1. the document itself is published (partner_visible), AND
//   2. every folder on its path to the root is published.
//
// The second condition is the one that is easy to get wrong. It is not
// enough to check the immediate parent: a published "Datasheets" folder
// nested inside an unpublished "Internal" folder must stay hidden, or the
// boundary Marketing thinks they drew does not exist. The folder chain is
// walked to the root for exactly that reason.
//
// Audience then narrows further, and is checked last because it is the
// cheapest to reason about: [] means "all partners", otherwise membership.

export interface PublishableFolder {
  id: string;
  parentId: string | null;
  partnerVisible: boolean;
}

export interface PublishableMaterial {
  id: string;
  folderId: string | null;
  partnerVisible: boolean;
  /** [] = every partner. Otherwise the partner ids allowed to see it. */
  partnerAudience: string[];
}

/**
 * Is every folder from `folderId` up to the root published?
 *
 * A material at the top level (folderId null) has no chain to walk and
 * passes this gate — the top level is not a folder and cannot be
 * un-published, so publication of the document alone governs there.
 *
 * Fails CLOSED on a broken tree: a parent id that does not resolve, or a
 * cycle, returns false. A library whose structure is corrupt must not
 * default to publishing.
 */
export function folderChainPublished(folders: PublishableFolder[], folderId: string | null): boolean {
  if (!folderId) return true;

  const byId = new Map(folders.map((f) => [f.id, f]));
  const seen = new Set<string>();
  let current: string | null = folderId;

  while (current) {
    // A cycle means the tree is corrupt. lib/materialFolderTree.ts prevents
    // them on write, but this function must not hang if one ever exists.
    if (seen.has(current)) return false;
    seen.add(current);

    const folder: PublishableFolder | undefined = byId.get(current);
    // A dangling parent reference — treat as unpublished rather than
    // assuming the missing folder would have been open.
    if (!folder) return false;
    if (!folder.partnerVisible) return false;

    current = folder.parentId;
  }
  return true;
}

/** Does this partner fall inside the document's audience? */
export function audienceAllows(partnerAudience: string[], partnerId: string): boolean {
  // Empty = published to every partner. This is the common case: most
  // collateral is for the whole channel, and requiring an explicit list
  // would make the ordinary action the laborious one.
  if (!partnerAudience || partnerAudience.length === 0) return true;
  if (!partnerId) return false;
  return partnerAudience.includes(partnerId);
}

/** The full rule, for one document. */
export function materialVisibleToPartner(
  material: PublishableMaterial,
  folders: PublishableFolder[],
  partnerId: string
): boolean {
  if (!partnerId) return false;
  if (!material.partnerVisible) return false;
  if (!folderChainPublished(folders, material.folderId)) return false;
  return audienceAllows(material.partnerAudience, partnerId);
}

/**
 * The folders a partner should see in the browser tree.
 *
 * A folder is listed only if its own chain is published AND it would
 * actually lead somewhere — a published but empty branch is noise, and
 * worse, it advertises the existence of a structure the partner cannot
 * reach into.
 */
export function partnerVisibleFolders(
  folders: PublishableFolder[],
  visibleMaterials: PublishableMaterial[]
): PublishableFolder[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const keep = new Set<string>();

  // Mark every folder that directly holds a visible document, then walk up
  // so its ancestors survive too — otherwise the tree would have holes and
  // a nested folder could not be navigated to.
  for (const material of visibleMaterials) {
    let current = material.folderId;
    const guard = new Set<string>();
    while (current && !guard.has(current)) {
      guard.add(current);
      keep.add(current);
      current = byId.get(current)?.parentId ?? null;
    }
  }

  return folders.filter((f) => keep.has(f.id) && folderChainPublished(folders, f.id));
}
