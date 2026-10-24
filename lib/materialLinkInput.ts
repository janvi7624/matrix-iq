import { isDriveLink, parseDriveLink } from './driveLink';
import { parseCustomLink } from './customLink';
import { filesExist } from './fileStorage';
import { MaterialSource } from './materialStore';

// Resolving which of the three add-a-material paths was used — a Google Drive
// link, a file uploaded through /api/uploads and now sitting in this app's own
// storage, or any other web address (a product video, a supplier's page, a
// Dropbox or OneDrive share). Shared by the POST (create) and PATCH (edit)
// routes so the two can't validate a link differently.

export interface ResolvedMaterialLink {
  webViewLink: string;
  driveFileId: string;
  isFolder: boolean;
  source: MaterialSource;
  mimeType: string;
}

export type MaterialLinkResolution = { ok: true; value: ResolvedMaterialLink } | { ok: false; error: string };

const UPLOAD_URL_PREFIX = '/api/uploads/file/';
// Uploads for materials are always posted to /api/uploads with folder=materials
// (components/MaterialsView.tsx) — requiring that prefix here means a
// material can't be pointed at some OTHER feature's upload (an expense bill,
// a PO document) just by pasting its already-authenticated URL; the file has
// to have actually been uploaded for this purpose.
const UPLOAD_PATH_PREFIX = 'uploads/materials/';

function uploadStoragePathname(url: string): string | null {
  if (!url.startsWith(UPLOAD_URL_PREFIX)) return null;
  try {
    const pathname = url
      .slice(UPLOAD_URL_PREFIX.length)
      .split('/')
      .map(decodeURIComponent)
      .join('/');
    return pathname.startsWith(UPLOAD_PATH_PREFIX) ? pathname : null;
  } catch {
    return null;
  }
}

export async function resolveMaterialLink(input: {
  /** Which of the three paths the form chose. See the dispatch note below. */
  source?: string;
  driveLink?: string;
  uploadedFileUrl?: string;
  customLink?: string;
  mimeType?: string;
}): Promise<MaterialLinkResolution> {
  const driveLink = (input.driveLink || '').trim();
  const uploadedFileUrl = (input.uploadedFileUrl || '').trim();
  const customLink = (input.customLink || '').trim();

  // Dispatch on what the form says it chose, not on whichever field happens to
  // be populated. The two-path version of this function tested uploadedFileUrl
  // first and fell through to driveLink, which silently saved the wrong one
  // whenever both were filled: upload a file, switch back to "Google Drive
  // link", paste a link, save — and the stale upload won, with the pasted link
  // discarded. A third path would have made that a three-way coin toss. The
  // inferred fallback is kept only so a request from an older client, which
  // sends no source at all, still resolves the way it used to.
  const mode: MaterialSource =
    input.source === 'drive' || input.source === 'upload' || input.source === 'link'
      ? input.source
      : uploadedFileUrl
        ? 'upload'
        : customLink && !driveLink
          ? 'link'
          : 'drive';

  if (mode === 'upload') {
    if (!uploadedFileUrl) return { ok: false, error: 'Choose a file to upload.' };
    const pathname = uploadStoragePathname(uploadedFileUrl);
    if (!pathname) return { ok: false, error: 'That upload link is not valid.' };
    // Never trust the client's say-so that the file exists — confirm it was
    // actually written to this app's own storage (lib/fileStorage.ts), not
    // just a plausible-looking path.
    const found = await filesExist([pathname]);
    if (!found.has(pathname)) {
      return { ok: false, error: 'That upload could not be found — please upload the file again.' };
    }
    return {
      ok: true,
      value: { webViewLink: uploadedFileUrl, driveFileId: '', isFolder: false, source: 'upload', mimeType: (input.mimeType || '').trim() }
    };
  }

  if (mode === 'link') {
    if (!customLink) return { ok: false, error: 'Paste the web address, or pick one of the other two options.' };
    // A Drive link belongs on the Drive path even when it was pasted here.
    // That path records the file id, which is both what the partial unique
    // index uses to stop one document being added twice and what tells a
    // folder from a file. Stored as a plain web link it would have neither.
    if (isDriveLink(customLink)) {
      return {
        ok: false,
        error: 'That’s a Google Drive link — switch to “Google Drive link” above so it’s filed as one.'
      };
    }
    const parsed = parseCustomLink(customLink);
    if (!parsed) {
      return {
        ok: false,
        error: 'That doesn’t look like a web address. It has to start with https:// or http://.'
      };
    }
    // mimeType stays empty deliberately: nothing here read the file, so any
    // content-type would be invented. The 20261022110000 migration sets out
    // why only a real upload's type is worth keeping.
    return {
      ok: true,
      value: { webViewLink: parsed.url, driveFileId: '', isFolder: false, source: 'link', mimeType: '' }
    };
  }

  const parsed = parseDriveLink(driveLink);
  if (!parsed) {
    return {
      ok: false,
      error: driveLink
        ? 'That doesn’t look like a Google Drive link. Paste the link from Drive’s Share dialog or the address bar.'
        : 'Paste a Google Drive link, upload a file, or paste a web address.'
    };
  }
  return {
    ok: true,
    value: { webViewLink: parsed.url, driveFileId: parsed.id, isFolder: parsed.kind === 'folder', source: 'drive', mimeType: '' }
  };
}

// Whether a PATCH body actually touched the link — so "no change" stays
// distinguishable from "resolve a new one", the same way every other optional
// field on this route already works.
//
// This asks whether a link field arrived NON-EMPTY, not merely whether the key
// is there, and the difference matters: the edit form PATCHes its whole form
// object (components/MaterialsView.tsx handleSave), so all three keys are
// always present and exactly one of them is ever filled in. Checking presence
// alone would make this permanently true, and an edit to just the title of a
// material would then re-resolve a link field that its own mode left blank —
// failing the whole PATCH on a link the user never touched, and losing the
// title change with it. Nothing legitimate is lost by the stricter test:
// web_view_link is NOT NULL and the resolver never returns an empty one, so
// "clear the link" was never a thing this route could express.
export function materialLinkFieldsPresent(body: Record<string, unknown>): boolean {
  const filled = (key: string) => typeof body[key] === 'string' && (body[key] as string).trim().length > 0;
  return filled('driveLink') || filled('uploadedFileUrl') || filled('customLink');
}
