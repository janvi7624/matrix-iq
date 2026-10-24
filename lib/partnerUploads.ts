// Where a partner's uploaded files live, and who may read them back.
//
// Pure string logic, no imports — so both the upload route and the download
// route derive the same answer from the same function rather than each
// re-implementing it.
//
// The problem this solves: /api/uploads/file/[...path] authenticates the
// session but has never checked who OWNS the file. That was fine while every
// session belonged to an employee — any employee may read any company
// attachment. It stops being fine the moment external partners have
// sessions: without a rule, Partner A could read Partner B's uploaded
// documents by guessing or iterating a path.
//
// The rule is structural rather than a database lookup: a partner's files go
// under a prefix containing their partner id, and a partner may read exactly
// that prefix. No per-file ownership table, no extra query on every image
// load, and nothing to fall out of sync.

/** Every partner upload lives under this prefix. */
export function partnerUploadPrefix(partnerId: string): string {
  return `uploads/partner/${partnerId}/`;
}

/**
 * May a partner session read this stored path?
 *
 * Deliberately strict:
 *  - the path must sit under THIS partner's prefix;
 *  - '..' anywhere is refused outright, so a traversal segment can never
 *    walk out of the prefix after it has been matched.
 *
 * Everything else — internal uploads, another partner's prefix, a malformed
 * path — is denied. Internal staff do not go through this function at all;
 * their existing any-authenticated-employee access is unchanged.
 */
export function partnerMayReadUpload(pathname: string, partnerId: string): boolean {
  if (!partnerId || !pathname) return false;
  if (pathname.includes('..')) return false;
  return pathname.startsWith(partnerUploadPrefix(partnerId));
}

/**
 * Is this an internal (non-partner) upload path?
 *
 * Used only for clarity at call sites; a partner is granted access by
 * partnerMayReadUpload alone, never by this returning false.
 */
export function isPartnerUploadPath(pathname: string): boolean {
  return pathname.startsWith('uploads/partner/');
}
