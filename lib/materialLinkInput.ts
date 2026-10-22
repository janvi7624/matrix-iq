import { parseDriveLink } from './driveLink';
import { filesExist } from './fileStorage';
import { MaterialSource } from './materialStore';

// Resolving "which of the two add-a-material paths was used" — a Google
// Drive link (unchanged) or a file uploaded through /api/uploads and now
// sitting in this app's own storage. Shared by the POST (create) and PATCH
// (edit) routes so the two can't validate a link differently.

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
  driveLink?: string;
  uploadedFileUrl?: string;
  mimeType?: string;
}): Promise<MaterialLinkResolution> {
  const driveLink = (input.driveLink || '').trim();
  const uploadedFileUrl = (input.uploadedFileUrl || '').trim();

  if (uploadedFileUrl) {
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

  const parsed = parseDriveLink(driveLink);
  if (!parsed) {
    return {
      ok: false,
      error: driveLink
        ? 'That doesn’t look like a Google Drive link. Paste the link from Drive’s Share dialog or the address bar.'
        : 'Paste a Google Drive link, or upload a file.'
    };
  }
  return {
    ok: true,
    value: { webViewLink: parsed.url, driveFileId: parsed.id, isFolder: parsed.kind === 'folder', source: 'drive', mimeType: '' }
  };
}

// Whether a PATCH body actually touched the link — so "no change" (neither
// key sent) stays distinguishable from "resolve a new one", the same way
// every other optional field on this route already works.
export function materialLinkFieldsPresent(body: Record<string, unknown>): boolean {
  return body.driveLink !== undefined || body.uploadedFileUrl !== undefined;
}
