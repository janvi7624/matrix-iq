import { describe, it, expect, vi, beforeEach } from 'vitest';

// The actual bug report: a partner could SEE Marketing Materials (the module
// itself loaded fine) but opening a document that was uploaded directly
// (not pasted as a Drive/external link) 404'd — app/api/uploads/file/
// [...path]/route.ts's ownership check only ever recognised a partner's OWN
// uploaded files (lib/partnerUploads.ts's own-prefix rule), and a marketing
// document is uploaded by MARKETING STAFF, under an internal path, so it
// could never match that rule regardless of the "Share with partners"
// toggle. This pins the new carve-out in lib/partnerMaterialStore.ts.

const materialRows = vi.hoisted(() => [] as Record<string, unknown>[]);
const folderRows = vi.hoisted(() => [] as Record<string, unknown>[]);

vi.mock('../../lib/db', () => ({
  db: {
    Material: { findOne: vi.fn(async ({ where }: { where: { web_view_link: string } }) => {
      const row = materialRows.find((m) => m.web_view_link === where.web_view_link);
      return row ? { get: (opts?: unknown) => (opts ? row : undefined) } : null;
    }) },
    MaterialFolder: { findAll: vi.fn(async () => folderRows.map((f) => ({ get: () => f }))) }
  },
  isUuid: () => true
}));

import { partnerMayReadMaterialFile } from '../../lib/partnerMaterialStore';

const PARTNER = 'partner-1';
const STORED_PATH = 'uploads/materials/mktg_staff/1700000000-ab12cd34-brochure.pdf';
const STORED_URL = `/api/uploads/file/${STORED_PATH.split('/').map(encodeURIComponent).join('/')}`;

function material(over: Record<string, unknown> = {}) {
  return {
    id: 'mat-1',
    web_view_link: STORED_URL,
    folder_id: null,
    partner_visible: true,
    partner_audience: [],
    ...over
  };
}

beforeEach(() => {
  materialRows.length = 0;
  folderRows.length = 0;
});

describe('partnerMayReadMaterialFile', () => {
  it('allows a partner to read a published, top-level material uploaded directly', async () => {
    materialRows.push(material());
    expect(await partnerMayReadMaterialFile(STORED_PATH, PARTNER)).toBe(true);
  });

  it('refuses a path that is not a known Material at all (a real own-upload or a forged path)', async () => {
    expect(await partnerMayReadMaterialFile('uploads/misc/someone/whatever.pdf', PARTNER)).toBe(false);
  });

  it('refuses a material that exists but is NOT published to partners', async () => {
    materialRows.push(material({ partner_visible: false }));
    expect(await partnerMayReadMaterialFile(STORED_PATH, PARTNER)).toBe(false);
  });

  it('refuses a published material sitting inside an UNPUBLISHED folder (the two-gate rule)', async () => {
    materialRows.push(material({ folder_id: 'folder-1' }));
    folderRows.push({ id: 'folder-1', parent_id: null, partner_visible: false });
    expect(await partnerMayReadMaterialFile(STORED_PATH, PARTNER)).toBe(false);
  });

  it('allows it once the folder is also published', async () => {
    materialRows.push(material({ folder_id: 'folder-1' }));
    folderRows.push({ id: 'folder-1', parent_id: null, partner_visible: true });
    expect(await partnerMayReadMaterialFile(STORED_PATH, PARTNER)).toBe(true);
  });

  it('refuses a partner outside a narrowed audience, allows one inside it', async () => {
    materialRows.push(material({ partner_audience: ['partner-2', 'partner-3'] }));
    expect(await partnerMayReadMaterialFile(STORED_PATH, PARTNER)).toBe(false);
    expect(await partnerMayReadMaterialFile(STORED_PATH, 'partner-2')).toBe(true);
  });

  it('refuses a path containing a traversal segment outright', async () => {
    materialRows.push(material({ web_view_link: `/api/uploads/file/uploads/materials/../../secrets.pdf` }));
    expect(await partnerMayReadMaterialFile('uploads/materials/../../secrets.pdf', PARTNER)).toBe(false);
  });
});
