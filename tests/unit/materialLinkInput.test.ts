import { describe, it, expect, vi, beforeEach } from 'vitest';

// filesExist is the one side effect in this module, and it reaches a real
// Sequelize connection: lib/fileStorage imports lib/db, which requires
// db/models at module scope. Mocked rather than exercised, the same way the
// other store tests mock lib/db (tests/unit/partnerStatusTransitions.test.ts).
const found = vi.fn<(paths: string[]) => Promise<Set<string>>>();
vi.mock('../../lib/fileStorage', () => ({ filesExist: (paths: string[]) => found(paths) }));
vi.mock('../../lib/db', () => ({ db: {}, sequelize: {}, isUuid: () => true }));

import { materialLinkFieldsPresent, resolveMaterialLink } from '../../lib/materialLinkInput';

const DRIVE_FILE = 'https://drive.google.com/file/d/1SRXwd2o9wHwXxXPR7k/view';
const DRIVE_FOLDER = 'https://drive.google.com/drive/folders/1SRXwd2o9wHwXxXPR7k';
const UPLOAD = '/api/uploads/file/uploads/materials/x200.pdf';
const UPLOAD_PATH = 'uploads/materials/x200.pdf';

beforeEach(() => {
  found.mockReset();
  // Default: whatever upload path is asked about exists.
  found.mockImplementation(async (paths: string[]) => new Set(paths));
});

describe('resolveMaterialLink — which of the three paths was used', () => {
  // The regression this dispatch exists for. The old version tested
  // uploadedFileUrl first and fell through to driveLink, so whenever both
  // arrived the upload silently won and the typed link was thrown away.
  it('honours the chosen source when a stale sibling field is also populated', async () => {
    const drive = await resolveMaterialLink({ source: 'drive', driveLink: DRIVE_FILE, uploadedFileUrl: UPLOAD });
    expect(drive.ok).toBe(true);
    if (drive.ok) {
      expect(drive.value.source).toBe('drive');
      expect(drive.value.webViewLink).toBe(DRIVE_FILE);
    }

    const upload = await resolveMaterialLink({ source: 'upload', driveLink: DRIVE_FILE, uploadedFileUrl: UPLOAD });
    expect(upload.ok).toBe(true);
    if (upload.ok) expect(upload.value.source).toBe('upload');

    const link = await resolveMaterialLink({
      source: 'link',
      driveLink: DRIVE_FILE,
      uploadedFileUrl: UPLOAD,
      customLink: 'https://vendor.example.com/x.pdf'
    });
    expect(link.ok).toBe(true);
    if (link.ok) {
      expect(link.value.source).toBe('link');
      expect(link.value.webViewLink).toBe('https://vendor.example.com/x.pdf');
    }
  });

  // Only the Drive path records the file id, which is what the partial unique
  // index on drive_file_id uses to stop one document being filed twice, and
  // what tells a folder from a file. Stored as a plain web link it has neither.
  it('refuses a Drive link pasted into the web-link box', async () => {
    const result = await resolveMaterialLink({ source: 'link', customLink: DRIVE_FILE });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Google Drive link/);
  });

  it('leaves a web link with no Drive id, no folder flag and no invented mime type', async () => {
    // If driveFileId were ever non-empty here, two materials pointing at one
    // page would collide on materials_drive_file_id_unique.
    const result = await resolveMaterialLink({
      source: 'link',
      customLink: 'https://www.youtube.com/watch?v=abc',
      mimeType: 'video/mp4'
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.driveFileId).toBe('');
      expect(result.value.isFolder).toBe(false);
      // Claimed by the client but ignored: nothing here read any bytes.
      expect(result.value.mimeType).toBe('');
    }
  });

  it('normalises the stored web link rather than keeping the raw paste', async () => {
    const result = await resolveMaterialLink({ source: 'link', customLink: '  HTTPS://Example.COM/X200  ' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.webViewLink).toBe('https://example.com/X200');
  });

  it('refuses a web link that is not an http(s) address', async () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,<script>1</script>', '//evil.com', 'example.com/x']) {
      const result = await resolveMaterialLink({ source: 'link', customLink: bad });
      expect(result.ok).toBe(false);
    }
  });

  it('asks for a web address when the link box is empty', async () => {
    const result = await resolveMaterialLink({ source: 'link', customLink: '  ' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/web address/i);
  });

  it('knows a Drive folder link from a file link', async () => {
    const file = await resolveMaterialLink({ source: 'drive', driveLink: DRIVE_FILE });
    const folder = await resolveMaterialLink({ source: 'drive', driveLink: DRIVE_FOLDER });
    expect(file.ok && file.value.isFolder).toBe(false);
    expect(folder.ok && folder.value.isFolder).toBe(true);
  });

  it('names all three options when nothing was supplied at all', async () => {
    const result = await resolveMaterialLink({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Drive link.*upload.*web address/i);
  });
});

describe('resolveMaterialLink — the upload path', () => {
  it('asks for a file when upload mode arrives with nothing', async () => {
    const result = await resolveMaterialLink({ source: 'upload', uploadedFileUrl: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Choose a file/);
  });

  // The prefix guard: without it, a material could be pointed at another
  // feature's attachment (an expense bill, a PO document) just by pasting its
  // already-authenticated URL.
  it('refuses an upload URL belonging to another feature', async () => {
    const result = await resolveMaterialLink({
      source: 'upload',
      uploadedFileUrl: '/api/uploads/file/uploads/expenses/bill.pdf'
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not valid/);
    // Rejected on shape alone — storage is never consulted.
    expect(found).not.toHaveBeenCalled();
  });

  it('refuses an upload that is not actually in storage', async () => {
    found.mockImplementation(async () => new Set<string>());
    const result = await resolveMaterialLink({ source: 'upload', uploadedFileUrl: UPLOAD });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/could not be found/);
  });

  it('checks the decoded storage path, and keeps the real content type', async () => {
    const result = await resolveMaterialLink({ source: 'upload', uploadedFileUrl: UPLOAD, mimeType: 'application/pdf' });
    expect(found).toHaveBeenCalledWith([UPLOAD_PATH]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.source).toBe('upload');
      // Real File.type of bytes actually received, so it is kept — unlike the
      // Drive and web-link paths, where it would be a guess.
      expect(result.value.mimeType).toBe('application/pdf');
      expect(result.value.driveFileId).toBe('');
    }
  });
});

describe('resolveMaterialLink — a body from a client that sends no source', () => {
  // Kept for backwards compatibility, and the branch a future cleanup is most
  // likely to delete as dead, so its behaviour is pinned.
  it('infers the path from whichever field is filled in', async () => {
    const upload = await resolveMaterialLink({ uploadedFileUrl: UPLOAD });
    expect(upload.ok && upload.value.source).toBe('upload');

    const link = await resolveMaterialLink({ customLink: 'https://vendor.example.com/x.pdf' });
    expect(link.ok && link.value.source).toBe('link');

    const drive = await resolveMaterialLink({ driveLink: DRIVE_FILE });
    expect(drive.ok && drive.value.source).toBe('drive');

    // An upload beats everything, and a Drive link beats a web link — the
    // priority the two-path version had, left unchanged.
    const both = await resolveMaterialLink({ uploadedFileUrl: UPLOAD, driveLink: DRIVE_FILE });
    expect(both.ok && both.value.source).toBe('upload');
    const linkAndDrive = await resolveMaterialLink({ driveLink: DRIVE_FILE, customLink: 'https://vendor.example.com/x.pdf' });
    expect(linkAndDrive.ok && linkAndDrive.value.source).toBe('drive');
  });

  it('ignores a source it does not recognise rather than trusting it', async () => {
    const result = await resolveMaterialLink({ source: 'nonsense', driveLink: DRIVE_FILE });
    expect(result.ok && result.value.source).toBe('drive');
  });
});

describe('materialLinkFieldsPresent', () => {
  // The edit form PATCHes its whole form object, so all three keys are always
  // there and exactly one is ever filled in. Testing presence alone made this
  // permanently true, and a title-only edit of a material then re-resolved a
  // blank link field — failing the PATCH and losing the title change with it.
  it('reads three blank link fields as "the link was not touched"', () => {
    expect(materialLinkFieldsPresent({ title: 'New name', driveLink: '', uploadedFileUrl: '', customLink: '' })).toBe(false);
    expect(materialLinkFieldsPresent({ title: 'New name', driveLink: '   ', uploadedFileUrl: '  ', customLink: ' ' })).toBe(false);
  });

  it('spots whichever single field carries the new link', () => {
    expect(materialLinkFieldsPresent({ driveLink: DRIVE_FILE, uploadedFileUrl: '', customLink: '' })).toBe(true);
    expect(materialLinkFieldsPresent({ driveLink: '', uploadedFileUrl: UPLOAD, customLink: '' })).toBe(true);
    expect(materialLinkFieldsPresent({ driveLink: '', uploadedFileUrl: '', customLink: 'https://x.example.com' })).toBe(true);
  });

  it('is false for a body with no link keys at all', () => {
    expect(materialLinkFieldsPresent({ title: 'New name' })).toBe(false);
    expect(materialLinkFieldsPresent({})).toBe(false);
  });

  // A non-string is not a link, whatever it is.
  it('ignores a non-string value', () => {
    expect(materialLinkFieldsPresent({ driveLink: 42, uploadedFileUrl: null, customLink: undefined })).toBe(false);
  });
});
