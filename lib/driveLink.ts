// Parses a pasted Google Drive URL into the id and kind it points at, so a
// material can be added by link alone — no service account, no sync.
//
// People paste whatever the Drive UI gave them: the Share dialog's link, the
// address bar, a "open?id=" link from an old email. All of these are the same
// file, so all of them are accepted rather than only the one canonical shape.
//
// Pure string work, no network — the link is NOT verified to exist or to be
// readable. It can't be: the server has no Drive identity when this path is
// the one being used, which is the entire point of it.

export type DriveLinkKind = 'file' | 'folder';

export interface ParsedDriveLink {
  id: string;
  kind: DriveLinkKind;
  // Normalised back to the canonical viewer URL, so two people pasting the
  // same file in two different shapes produce the same stored link.
  url: string;
}

const PATTERNS: { re: RegExp; kind: DriveLinkKind }[] = [
  // https://drive.google.com/drive/folders/<id>   (and /drive/u/0/folders/<id>)
  { re: /\/folders\/([a-zA-Z0-9_-]{10,})/, kind: 'folder' },
  // https://drive.google.com/file/d/<id>/view
  // https://docs.google.com/document|spreadsheets|presentation/d/<id>/edit
  { re: /\/d\/([a-zA-Z0-9_-]{10,})/, kind: 'file' },
  // https://drive.google.com/open?id=<id>, /uc?id=<id>, ?id=<id>
  { re: /[?&]id=([a-zA-Z0-9_-]{10,})/, kind: 'file' }
];

export function parseDriveLink(input: string): ParsedDriveLink | null {
  const trimmed = (input || '').trim();
  if (!trimmed) return null;

  // Only Google's own hosts — a link to anywhere else isn't a Drive material,
  // and silently storing it would make "Open" lead somewhere unexpected.
  if (!/^https?:\/\/(drive|docs)\.google\.com\//i.test(trimmed)) return null;

  for (const { re, kind } of PATTERNS) {
    const match = trimmed.match(re);
    if (match) {
      const id = match[1];
      return {
        id,
        kind,
        url: kind === 'folder' ? `https://drive.google.com/drive/folders/${id}` : `https://drive.google.com/file/d/${id}/view`
      };
    }
  }

  return null;
}

// Whether a pasted string even looks like it belongs here — used for the
// form's inline validation message, which should say "that isn't a Drive
// link" rather than failing on save.
export function isDriveLink(input: string): boolean {
  return parseDriveLink(input) !== null;
}
