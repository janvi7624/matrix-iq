import { describe, it, expect } from 'vitest';
import {
  breadcrumbChainAllowsRole,
  folderChainAllowsRole,
  materialVisibleToRole,
  roleAllows,
  roleVisibleFolders,
  seesEveryRole,
  RoleScopedFolder,
  RoleScopedMaterial
} from '../../lib/materialRoleVisibility';

// Who may see which material, by role.
//
// The library was readable by every signed-in user before this existed, so
// the single most important property here is that an UNRESTRICTED row stays
// readable by everyone. Get the default backwards and the migration hides
// the entire library from the entire company at once — so that case is
// pinned first and from several angles.

const folder = (id: string, parentId: string | null, visibleToRoles: string[] = []): RoleScopedFolder => ({
  id,
  parentId,
  visibleToRoles
});
const doc = (id: string, folderId: string | null, visibleToRoles: string[] = []): RoleScopedMaterial => ({
  id,
  folderId,
  visibleToRoles
});

describe('roleAllows — the default is "everyone"', () => {
  it('admits every role when the list is empty', () => {
    for (const role of ['engineer', 'user', 'hr', 'accounts', 'marketing', 'manager', 'superadmin']) {
      expect(roleAllows([], role), `${role} must pass an empty list`).toBe(true);
    }
  });

  // Defensive: a row written before the column existed, or JSON that came
  // back as null, must not read as "nobody".
  it('admits every role when the list is missing altogether', () => {
    expect(roleAllows(undefined, 'engineer')).toBe(true);
    expect(roleAllows(null, 'engineer')).toBe(true);
  });

  it('admits only the named roles once the list is populated', () => {
    expect(roleAllows(['hr'], 'hr')).toBe(true);
    expect(roleAllows(['hr'], 'engineer')).toBe(false);
    expect(roleAllows(['hr', 'accounts'], 'accounts')).toBe(true);
  });

  // A viewer whose role could not be read must not inherit access to
  // something somebody went out of their way to narrow.
  it('refuses a blank role against a populated list, but not against an empty one', () => {
    expect(roleAllows(['hr'], '')).toBe(false);
    expect(roleAllows([], '')).toBe(true);
  });
});

describe('folderChainAllowsRole — the second gate', () => {
  // MatrixIQ SoP (open) / Engineer (engineer only)
  const tree = [folder('sop', null), folder('eng', 'sop', ['engineer']), folder('hr', 'sop', ['hr'])];

  it('passes the top level, which is not a folder and cannot be narrowed', () => {
    expect(folderChainAllowsRole(tree, null, 'engineer')).toBe(true);
    expect(folderChainAllowsRole(tree, null, '')).toBe(true);
  });

  it('lets the parent stay open while the children are narrowed', () => {
    expect(folderChainAllowsRole(tree, 'sop', 'hr')).toBe(true);
    expect(folderChainAllowsRole(tree, 'eng', 'engineer')).toBe(true);
    expect(folderChainAllowsRole(tree, 'eng', 'hr')).toBe(false);
    expect(folderChainAllowsRole(tree, 'hr', 'engineer')).toBe(false);
  });

  // The whole point of walking to the root rather than checking the parent:
  // an open folder nested inside a narrowed one must stay narrowed.
  it('keeps an OPEN folder closed when an ancestor is narrowed', () => {
    const nested = [folder('internal', null, ['hr']), folder('open', 'internal')];
    expect(folderChainAllowsRole(nested, 'open', 'hr')).toBe(true);
    expect(folderChainAllowsRole(nested, 'open', 'engineer')).toBe(false);
  });

  it('fails closed on a dangling parent', () => {
    expect(folderChainAllowsRole([folder('orphan', 'gone')], 'orphan', 'engineer')).toBe(false);
  });

  // Must not hang. The write path prevents cycles; this is the backstop.
  it('fails closed on a cycle instead of looping forever', () => {
    const cyclic = [folder('a', 'b'), folder('b', 'a')];
    expect(folderChainAllowsRole(cyclic, 'a', 'engineer')).toBe(false);
  });
});

describe('materialVisibleToRole — both gates together', () => {
  const tree = [folder('sop', null), folder('eng', 'sop', ['engineer']), folder('hr', 'sop', ['hr'])];

  it('shows an unrestricted document in an unrestricted folder to everyone', () => {
    const brochure = doc('m1', 'sop');
    for (const role of ['engineer', 'hr', 'accounts', 'user']) {
      expect(materialVisibleToRole(brochure, tree, role), role).toBe(true);
    }
  });

  it('shows a role folder only to that role', () => {
    const engineerSop = doc('m2', 'eng');
    expect(materialVisibleToRole(engineerSop, tree, 'engineer')).toBe(true);
    expect(materialVisibleToRole(engineerSop, tree, 'hr')).toBe(false);
  });

  // The failure this guards: somebody files a document into a role folder
  // and leaves its own roles empty. The folder has to be the boundary, or
  // every mis-filed document leaks.
  it('keeps an unrestricted document inside a narrowed folder narrowed', () => {
    expect(materialVisibleToRole(doc('m3', 'eng'), tree, 'hr')).toBe(false);
  });

  // And the other way: a document narrowed to hr, sitting at the top level,
  // is still narrowed even though no folder restricts it.
  it('honours the document\'s own list at the top level', () => {
    expect(materialVisibleToRole(doc('m4', null, ['hr']), tree, 'hr')).toBe(true);
    expect(materialVisibleToRole(doc('m4', null, ['hr']), tree, 'engineer')).toBe(false);
  });
});

describe('roleVisibleFolders', () => {
  const tree = [folder('sop', null), folder('eng', 'sop', ['engineer']), folder('hr', 'sop', ['hr']), folder('open', null)];

  it('gives a role the open folders plus its own', () => {
    expect(roleVisibleFolders(tree, 'engineer').map((f) => f.id).sort()).toEqual(['eng', 'open', 'sop']);
    expect(roleVisibleFolders(tree, 'hr').map((f) => f.id).sort()).toEqual(['hr', 'open', 'sop']);
  });

  // Deliberately unlike partnerVisibleFolders, which prunes a branch that
  // leads nowhere. An engineer should see their own SoP folder on the day it
  // is created, before anything is filed in it.
  it('keeps an empty folder the role is entitled to', () => {
    const empty = [folder('sop', null), folder('eng', 'sop', ['engineer'])];
    expect(roleVisibleFolders(empty, 'engineer').map((f) => f.id)).toContain('eng');
  });
});

describe('seesEveryRole', () => {
  it('lets superadmin past the gate', () => {
    expect(seesEveryRole('superadmin', false)).toBe(true);
  });

  // A curator who cannot see a folder cannot fix a document mis-filed into
  // it — narrowing a folder to another role would otherwise put it beyond
  // the reach of the only people with an edit form.
  it('lets whoever may manage materials past the gate', () => {
    expect(seesEveryRole('marketing', true)).toBe(true);
  });

  it('gates everybody else', () => {
    for (const role of ['engineer', 'user', 'hr', 'accounts', 'manager', 'admin']) {
      expect(seesEveryRole(role, false), role).toBe(false);
    }
  });
});
