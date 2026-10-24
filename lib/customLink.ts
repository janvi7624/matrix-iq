// Parses a pasted web address for a material that lives neither in Google
// Drive nor in MatrixIQ's own storage — a product video on YouTube, a
// supplier's spec page, a Dropbox or OneDrive share.
//
// Pure string work, no network: exactly as lib/driveLink.ts cannot check that
// a Drive file exists, nothing here checks that the page loads or that the
// team can read it. Nothing server-side ever fetches this value either. If
// that ever changes, SSRF-guard at the fetch site rather than here — an
// input-time host check is unsound against DNS rebinding, and would reject
// the legitimate intranet links a vendor datasheet often lives on.
//
// This parser is the only thing between a pasted string and an <a href> shown
// to every employee — and, once published, to external partner users
// (components/PartnerMaterialsView.tsx). React 19 blocks `javascript:` hrefs
// by itself, but nothing else: `data:`, `vbscript:` and protocol-relative
// `//evil.com` all reach the DOM untouched, and this app sets no
// Content-Security-Policy. So this is an ALLOW-LIST of http/https, not a
// blocklist of the schemes known today to be bad — a blocklist loses to
// `intent:`, `view-source:` and whatever ships next.
//
// Same rule as the unexported isUrlLike in lib/dailyReportTemplates.ts, which
// validates daily-report URL fields. Not imported from there on purpose: that
// module is a ~1300-line template engine kept free of sibling imports. If the
// rule changes, change it in both.

export interface ParsedCustomLink {
  // Normalised through the URL parser, so two people pasting the same address
  // in different shapes produce the same stored link.
  url: string;
  // The destination, for telling somebody where "Open" is about to take them.
  host: string;
}

// Generous, because SharePoint and OneDrive share links carry long tokens.
// web_view_link is TEXT with no limit of its own, so without a cap here a
// paste could store megabytes on the row.
const MAX_LENGTH = 2048;

export function parseCustomLink(input: string): ParsedCustomLink | null {
  const trimmed = (input || '').trim();
  if (!trimmed || trimmed.length > MAX_LENGTH) return null;

  let url: URL;
  try {
    // No base is passed, deliberately. That is what makes the parser reject a
    // relative path ('/api/...'), a bare host ('example.com') and a
    // protocol-relative '//evil.com' — the last of which would otherwise
    // resolve against the page's own scheme and navigate off-site while
    // reading in the UI like an internal path.
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  // Read url.host, never a substring of the input: the host of
  // 'https://drive.google.com@evil.com/x' is evil.com, with the familiar-
  // looking part sitting in the username.
  if (!url.host) return null;
  // Credentials in a link shared across the company are a leak in themselves,
  // and user:pass@host is how a hostile link is dressed up as a friendly one.
  if (url.username || url.password) return null;
  // The one app-specific rule: this must not become a way to point a material
  // at MatrixIQ's own upload endpoint, which would skip both the filesExist()
  // check and the uploads/materials/ prefix guard that lib/materialLinkInput.ts
  // installs on the upload path. Matched on the path alone, so the browser and
  // the server agree without either having to know the app's own hostname.
  if (url.pathname.startsWith('/api/uploads/')) return null;

  return { url: url.toString(), host: url.host };
}

// Whether a pasted string even looks like a web address — used for the form's
// inline message, which should say so as you type rather than failing on save.
// The form and the API both call this, so the form can never accept a link the
// server will reject.
export function isCustomLink(input: string): boolean {
  return parseCustomLink(input) !== null;
}
