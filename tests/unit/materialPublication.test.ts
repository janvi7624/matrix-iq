import { describe, it, expect } from 'vitest';
import {
  PublishableFolder,
  PublishableMaterial,
  audienceAllows,
  folderChainPublished,
  materialVisibleToPartner,
  partnerVisibleFolders
} from '../../lib/materialPublication';

// A mistake here publishes internal sales decks and competitor comparisons
// to external companies, so the folder-chain rule is pinned down explicitly.

const PARTNER_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const PARTNER_B = 'bbbbbbbb-0000-0000-0000-000000000002';

//   internal (closed)
//     └── leaks (open)        <- open, but its parent is closed
//   public (open)
//     └── datasheets (open)
//         └── drafts (closed)
const FOLDERS: PublishableFolder[] = [
  { id: 'internal', parentId: null, partnerVisible: false },
  { id: 'leaks', parentId: 'internal', partnerVisible: true },
  { id: 'public', parentId: null, partnerVisible: true },
  { id: 'datasheets', parentId: 'public', partnerVisible: true },
  { id: 'drafts', parentId: 'datasheets', partnerVisible: false }
];

function material(over: Partial<PublishableMaterial> = {}): PublishableMaterial {
  return { id: 'm1', folderId: null, partnerVisible: true, partnerAudience: [], ...over };
}

describe('folderChainPublished', () => {
  it('passes a document at the top level', () => {
    // The top level is not a folder and cannot be un-published, so the
    // document's own flag governs there.
    expect(folderChainPublished(FOLDERS, null)).toBe(true);
  });

  it('passes a fully published chain', () => {
    expect(folderChainPublished(FOLDERS, 'datasheets')).toBe(true);
  });

  it('blocks an open folder nested inside a closed one', () => {
    // THE case this rule exists for. Checking only the immediate parent
    // would wrongly pass 'leaks', and the boundary Marketing drew around
    // 'internal' would not exist.
    expect(folderChainPublished(FOLDERS, 'leaks')).toBe(false);
  });

  it('blocks a closed folder even when its ancestors are open', () => {
    expect(folderChainPublished(FOLDERS, 'drafts')).toBe(false);
  });

  it('fails closed on a dangling parent reference', () => {
    const broken: PublishableFolder[] = [{ id: 'orphan', parentId: 'missing', partnerVisible: true }];
    expect(folderChainPublished(broken, 'orphan')).toBe(false);
  });

  it('fails closed, and terminates, on a cycle', () => {
    const cyclic: PublishableFolder[] = [
      { id: 'x', parentId: 'y', partnerVisible: true },
      { id: 'y', parentId: 'x', partnerVisible: true }
    ];
    expect(folderChainPublished(cyclic, 'x')).toBe(false);
  });
});

describe('audienceAllows', () => {
  it('treats an empty audience as every partner', () => {
    expect(audienceAllows([], PARTNER_A)).toBe(true);
  });

  it('admits only listed partners when an audience is set', () => {
    expect(audienceAllows([PARTNER_A], PARTNER_A)).toBe(true);
    expect(audienceAllows([PARTNER_A], PARTNER_B)).toBe(false);
  });

  it('fails closed with no partner id', () => {
    expect(audienceAllows([PARTNER_A], '')).toBe(false);
  });
});

describe('materialVisibleToPartner', () => {
  it('shows a published document in a published folder', () => {
    expect(materialVisibleToPartner(material({ folderId: 'datasheets' }), FOLDERS, PARTNER_A)).toBe(true);
  });

  it('hides an unpublished document even in a published folder', () => {
    expect(materialVisibleToPartner(material({ folderId: 'datasheets', partnerVisible: false }), FOLDERS, PARTNER_A)).toBe(false);
  });

  it('hides a published document whose folder chain is closed', () => {
    // Both gates must pass — ticking the document alone is not enough.
    expect(materialVisibleToPartner(material({ folderId: 'leaks' }), FOLDERS, PARTNER_A)).toBe(false);
    expect(materialVisibleToPartner(material({ folderId: 'drafts' }), FOLDERS, PARTNER_A)).toBe(false);
  });

  it('respects a narrowed audience', () => {
    const m = material({ folderId: 'datasheets', partnerAudience: [PARTNER_A] });
    expect(materialVisibleToPartner(m, FOLDERS, PARTNER_A)).toBe(true);
    expect(materialVisibleToPartner(m, FOLDERS, PARTNER_B)).toBe(false);
  });

  it('fails closed with no partner id', () => {
    expect(materialVisibleToPartner(material({ folderId: 'datasheets' }), FOLDERS, '')).toBe(false);
  });
});

describe('partnerVisibleFolders', () => {
  it('lists a folder holding a visible document, and its ancestors', () => {
    const visible = [material({ id: 'm1', folderId: 'datasheets' })];
    const ids = partnerVisibleFolders(FOLDERS, visible).map((f) => f.id).sort();
    // 'public' is kept so 'datasheets' can be navigated to.
    expect(ids).toEqual(['datasheets', 'public']);
  });

  it('omits published folders that lead nowhere', () => {
    // A published but empty branch advertises a structure the partner cannot
    // reach into.
    expect(partnerVisibleFolders(FOLDERS, []).map((f) => f.id)).toEqual([]);
  });

  it('never lists a folder whose chain is closed', () => {
    const visible = [material({ id: 'm2', folderId: 'leaks' })];
    expect(partnerVisibleFolders(FOLDERS, visible).map((f) => f.id)).toEqual([]);
  });
});
