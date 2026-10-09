import { describe, it, expect } from 'vitest';
import {
  assertCanCreate,
  assertCanMove,
  descendantIds,
  directChildren,
  folderDepth,
  folderPath,
  FolderNode,
  FolderTreeError,
  hasSiblingNamed,
  MAX_FOLDER_DEPTH
} from '../../lib/materialFolderTree';

// Robots / Industrial / Arm, plus a sibling top-level folder.
const TREE: FolderNode[] = [
  { id: 'robots', name: 'Robots', parentId: null },
  { id: 'industrial', name: 'Industrial', parentId: 'robots' },
  { id: 'arm', name: 'Arm', parentId: 'industrial' },
  { id: 'amr', name: 'AMR', parentId: 'robots' },
  { id: 'drones', name: 'Drones', parentId: null }
];

describe('folderPath', () => {
  it('reads root-first, which is what the breadcrumb shows', () => {
    expect(folderPath(TREE, 'arm').map((f) => f.name)).toEqual(['Robots', 'Industrial', 'Arm']);
  });

  it('is empty at the root', () => {
    expect(folderPath(TREE, null)).toEqual([]);
  });

  it('is empty for a folder that no longer exists', () => {
    expect(folderPath(TREE, 'deleted')).toEqual([]);
  });

  it('terminates on a corrupt parent chain instead of hanging', () => {
    // A hung request is far worse to diagnose than a short breadcrumb, so a
    // cycle in the data must not loop forever.
    const cyclic: FolderNode[] = [
      { id: 'a', name: 'A', parentId: 'b' },
      { id: 'b', name: 'B', parentId: 'a' }
    ];
    expect(folderPath(cyclic, 'a').length).toBeLessThanOrEqual(2);
  });
});

describe('folderDepth', () => {
  it('counts the root as depth 0', () => {
    expect(folderDepth(TREE, null)).toBe(0);
    expect(folderDepth(TREE, 'robots')).toBe(1);
    expect(folderDepth(TREE, 'arm')).toBe(3);
  });
});

describe('descendantIds', () => {
  it('finds every folder below one, at any depth', () => {
    expect(descendantIds(TREE, 'robots')).toEqual(new Set(['industrial', 'arm', 'amr']));
  });

  it('is empty for a leaf', () => {
    expect(descendantIds(TREE, 'arm')).toEqual(new Set());
  });

  it('terminates on a cycle', () => {
    const cyclic: FolderNode[] = [
      { id: 'a', name: 'A', parentId: null },
      { id: 'b', name: 'B', parentId: 'a' },
      { id: 'a2', name: 'A2', parentId: 'b' },
      { id: 'b2', name: 'B2', parentId: 'a2' }
    ];
    expect(descendantIds(cyclic, 'a').size).toBe(3);
  });
});

describe('directChildren', () => {
  it('lists only the immediate children, A-Z', () => {
    expect(directChildren(TREE, 'robots').map((f) => f.name)).toEqual(['AMR', 'Industrial']);
  });

  it('lists the top level for a null parent', () => {
    expect(directChildren(TREE, null).map((f) => f.name)).toEqual(['Drones', 'Robots']);
  });

  it('orders numerically, so Gen 9 comes before Gen 10', () => {
    const numbered: FolderNode[] = [
      { id: '1', name: 'Gen 10', parentId: null },
      { id: '2', name: 'Gen 9', parentId: null }
    ];
    expect(directChildren(numbered, null).map((f) => f.name)).toEqual(['Gen 9', 'Gen 10']);
  });
});

describe('assertCanMove', () => {
  it('allows an ordinary move', () => {
    expect(() => assertCanMove(TREE, 'amr', 'drones')).not.toThrow();
    expect(() => assertCanMove(TREE, 'industrial', null)).not.toThrow();
  });

  it('refuses to move a folder inside itself', () => {
    expect(() => assertCanMove(TREE, 'robots', 'robots')).toThrow(FolderTreeError);
  });

  it('refuses to move a folder inside its own subfolder', () => {
    // This would detach the whole branch from the root — it would still
    // exist, but nothing could ever navigate to it again.
    expect(() => assertCanMove(TREE, 'robots', 'arm')).toThrow(/own subfolders/);
  });

  it('counts the moved subtree against the depth limit, not just the folder', () => {
    // Robots carries Industrial/Arm with it, so moving it two levels down
    // would push Arm past the limit even though Robots itself would fit.
    const deep: FolderNode[] = [
      ...TREE,
      { id: 'l1', name: 'L1', parentId: null },
      { id: 'l2', name: 'L2', parentId: 'l1' },
      { id: 'l3', name: 'L3', parentId: 'l2' }
    ];
    expect(() => assertCanMove(deep, 'robots', 'l3')).toThrow(/levels deep/);
  });

  it('allows a move that lands exactly at the limit', () => {
    const chain: FolderNode[] = [
      { id: 'a', name: 'A', parentId: null },
      { id: 'b', name: 'B', parentId: 'a' },
      { id: 'c', name: 'C', parentId: 'b' },
      { id: 'd', name: 'D', parentId: 'c' },
      { id: 'loose', name: 'Loose', parentId: null }
    ];
    // a/b/c/d is 4 deep; Loose lands at 5, which is allowed.
    expect(() => assertCanMove(chain, 'loose', 'd')).not.toThrow();
    expect(MAX_FOLDER_DEPTH).toBe(5);
  });
});

describe('assertCanCreate', () => {
  it('allows a folder at the top level', () => {
    expect(() => assertCanCreate(TREE, null)).not.toThrow();
  });

  it('refuses one past the depth limit', () => {
    const chain: FolderNode[] = [
      { id: 'a', name: 'A', parentId: null },
      { id: 'b', name: 'B', parentId: 'a' },
      { id: 'c', name: 'C', parentId: 'b' },
      { id: 'd', name: 'D', parentId: 'c' },
      { id: 'e', name: 'E', parentId: 'd' }
    ];
    expect(() => assertCanCreate(chain, 'e')).toThrow(/levels deep/);
    expect(() => assertCanCreate(chain, 'd')).not.toThrow();
  });
});

describe('hasSiblingNamed', () => {
  it('catches a duplicate name under the same parent', () => {
    expect(hasSiblingNamed(TREE, 'robots', 'Industrial')).toBe(true);
  });

  it('ignores case and surrounding space — they read as the same folder', () => {
    expect(hasSiblingNamed(TREE, 'robots', '  industrial  ')).toBe(true);
  });

  it('allows the same name under a different parent', () => {
    // Robots/Industrial and Drones/Industrial are different folders.
    expect(hasSiblingNamed(TREE, 'drones', 'Industrial')).toBe(false);
  });

  it('does not count the folder being renamed against itself', () => {
    expect(hasSiblingNamed(TREE, 'robots', 'Industrial', 'industrial')).toBe(false);
  });

  it('checks the top level too', () => {
    expect(hasSiblingNamed(TREE, null, 'Drones')).toBe(true);
    expect(hasSiblingNamed(TREE, null, 'Arm')).toBe(false);
  });
});
