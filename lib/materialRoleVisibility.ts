// Which marketing collateral a given internal ROLE may see.
//
// Pure, no imports — the same shape and for the same reason as
// lib/materialPublication.ts next door, which answers the partner question.
// Keeping the two side by side is deliberate: they are two independent
// narrowings of one library, and a reader comparing them should be able to
// see that they agree on the hard part (the folder chain) and differ only in
// who is asking.
//
// WHY THIS EXISTS. The library was readable by every signed-in user by
// design — app/api/materials/route.ts says so — because the point of the
// module was that anyone could find a datasheet without being granted access
// to the Drive folder behind it. That is still right for collateral. It
// stops being right once the library also holds the role-by-role SoPs: a
// folder per role is only useful if a role lands in its own, and fourteen
// sibling folders that all look equally relevant is worse than no structure
// at all.
//
// So restriction is OPT-IN, exactly like partner_visible was not:
// visible_to_roles = [] means "every internal role", which is what every row
// that existed before this held and what ordinary collateral should keep
// holding. A populated array is the narrowing.
//
// THE TWO-GATE RULE, again
// A document is visible to a role only if BOTH hold:
//   1. the document's own visible_to_roles admits the role, AND
//   2. every folder on its path to the root admits the role.
//
// The second is the one that matters here, and it is what makes the SoP
// structure work: "MatrixIQ SoP" stays open to everyone while each role
// folder inside it is narrowed, so the parent is browsable and the children
// are not interchangeable. It also fails the other way safely — a document
// left unrestricted inside a restricted folder does not leak, because the
// folder is a containing boundary.

export interface RoleScopedFolder {
  id: string;
  parentId: string | null;
  /** [] = every internal role. Otherwise the role keys allowed to browse it. */
  visibleToRoles: string[];
}

export interface RoleScopedMaterial {
  id: string;
  folderId: string | null;
  /** [] = every internal role. Otherwise the role keys allowed to open it. */
  visibleToRoles: string[];
}

/**
 * Does this one list admit this role?
 *
 * Empty = everyone, which is the common case and the historical behaviour of
 * every row in the library. Requiring an explicit list would have meant
 * migrating 60-odd modules' worth of collateral to say "all of them".
 *
 * A missing role answers no for a populated list: a signed-in user whose
 * role could not be read must not inherit access to a folder somebody went
 * out of their way to narrow.
 */
export function roleAllows(visibleToRoles: string[] | null | undefined, role: string): boolean {
  if (!visibleToRoles || visibleToRoles.length === 0) return true;
  if (!role) return false;
  return visibleToRoles.includes(role);
}

/**
 * Does every folder from `folderId` up to the root admit this role?
 *
 * A material at the top level (folderId null) has no chain to walk and
 * passes — the top level is not a folder and cannot be narrowed.
 *
 * Fails CLOSED on a broken tree, matching folderChainPublished: a parent id
 * that does not resolve, or a cycle, answers false. A library whose
 * structure is corrupt must not default to showing everything.
 */
export function folderChainAllowsRole(folders: RoleScopedFolder[], folderId: string | null, role: string): boolean {
  if (!folderId) return true;

  const byId = new Map(folders.map((f) => [f.id, f]));
  const seen = new Set<string>();
  let current: string | null = folderId;

  while (current) {
    // lib/materialFolderTree.ts prevents cycles on write; this must not hang
    // if one ever exists.
    if (seen.has(current)) return false;
    seen.add(current);

    const folder: RoleScopedFolder | undefined = byId.get(current);
    // A dangling parent reference — treat as closed rather than assuming the
    // missing folder would have been open.
    if (!folder) return false;
    if (!roleAllows(folder.visibleToRoles, role)) return false;

    current = folder.parentId;
  }
  return true;
}

/**
 * The same second gate over a BREADCRUMB rather than the whole folder list.
 *
 * The library already holds the chain from the open folder to the root, so a
 * screen can answer "is what I file here going to be reachable?" without
 * refetching the tree — the same convenience breadcrumbChainPublished
 * provides, expressed beside the rule it mirrors so the two cannot drift.
 */
export function breadcrumbChainAllowsRole(crumbs: { visibleToRoles: string[] }[], role: string): boolean {
  return crumbs.every((crumb) => roleAllows(crumb.visibleToRoles, role));
}

/** The full rule, for one document. */
export function materialVisibleToRole(
  material: RoleScopedMaterial,
  folders: RoleScopedFolder[],
  role: string
): boolean {
  if (!roleAllows(material.visibleToRoles, role)) return false;
  return folderChainAllowsRole(folders, material.folderId, role);
}

/**
 * The folders a given role should see in the browser.
 *
 * Deliberately NOT the partner equivalent's rule. partnerVisibleFolders also
 * drops a published branch that leads to no visible document, because
 * advertising an unreachable structure to an external company is a leak of
 * sorts. Internally the opposite is true: an empty "MatrixIQ SoP / Engineer"
 * folder should still be visible to an engineer, or the day Marketing files
 * the SoP is the first day the engineer learns the folder was ever meant for
 * them. So this filters on the chain alone and keeps empty branches.
 */
export function roleVisibleFolders(folders: RoleScopedFolder[], role: string): RoleScopedFolder[] {
  return folders.filter((folder) => folderChainAllowsRole(folders, folder.id, role));
}

/**
 * Who bypasses all of the above.
 *
 * Two kinds of person, for two different reasons:
 *
 *   superadmin — the account that has to be able to see the whole library to
 *   answer "why can't X see Y", which is unanswerable from inside a filtered
 *   view.
 *
 *   whoever may MANAGE materials — Marketing, who curate this library. A
 *   curator who cannot see a folder cannot fix a document mis-filed into it,
 *   and narrowing a folder to another role would otherwise make it
 *   permanently unreachable by the only people with an edit form. The
 *   alternative — a separate "manage" view that ignores the gate — is the
 *   same bypass with more code and two list paths to keep in step.
 *
 * Takes the already-computed manage flag rather than a viewer, so this file
 * stays pure and the caller keeps its one permission lookup.
 */
export function seesEveryRole(role: string, canManageMaterials: boolean): boolean {
  return role === 'superadmin' || canManageMaterials;
}
