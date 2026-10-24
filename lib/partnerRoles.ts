// Partner Portal constants — pure data with NO imports, for the same reason
// lib/leadSources.ts and lib/tmsConstants.ts have none: these values are
// needed by the Proxy (which must never touch Sequelize — see proxy.ts), by
// client components (Sidebar), and by server stores alike. One list, not
// three copies that drift.

/**
 * The two external-partner roles. Seeded in lib/roleStore.ts.
 *
 * Deliberately NOT members of moduleConfigStore's ALL_ROLES: being in that
 * list is what grants a role the whole Sales section, which is exactly what
 * a partner must never see. Partner module visibility is granted explicitly
 * instead, via PARTNER_PORTAL_MODULE_KEYS.
 */
export const PARTNER_ROLE_KEYS = ['partner-admin', 'partner-user'] as const;

export type PartnerRoleKey = (typeof PARTNER_ROLE_KEYS)[number];

export const PARTNER_ROLE_LABEL: Record<string, string> = {
  'partner-admin': 'Partner Admin',
  'partner-user': 'Partner User'
};

/**
 * Role-key test only — it answers "does this role key name a partner role",
 * NOT "is this viewer a partner".
 *
 * The authoritative answer to the second question is `partnerId`, which is a
 * real foreign key on the account, checked live against the partners table.
 * A role key is just a string an admin could in principle assign to anyone,
 * so it must never be the thing that gates tenant data. Use this for
 * labelling and nav, and `partnerId` for access control.
 */
export function isPartnerRoleKey(role: string): boolean {
  return (PARTNER_ROLE_KEYS as readonly string[]).includes(role);
}

/**
 * Every route area a partner session is allowed to reach. Everything else is
 * refused by proxy.ts before it ever reaches a handler.
 *
 * Kept as prefixes rather than exact paths because these are whole subtrees
 * (`/partner/projects/<id>`, `/api/uploads/file/<path>`).
 */
// Kept deliberately minimal: every entry is a route the portal actually
// calls. /profile and /api/profile were here speculatively and were removed —
// nothing in the portal used them, and allowing the page while its API
// refused partner sessions produced a screen that loaded and then failed.
//
// The four non-/partner entries that remain each serve both audiences:
//   /api/auth           logout, heartbeat, the forced password change
//   /api/notifications  the bell, which renders inside the portal shell
//   /api/sidebar        the nav itself
//   /api/config/public  company header + T&Cs for the quotation PDF
//   /api/uploads        attachments — scoped by path ownership, see
//                       lib/partnerUploads.ts, so a partner reads only
//                       their own prefix
// Anything not listed here is refused by proxy.ts before a handler runs.
export const PARTNER_ALLOWED_PREFIXES = [
  '/partner',
  '/api/partner',
  '/api/auth',
  '/api/notifications',
  '/api/sidebar',
  '/api/uploads',
  '/api/config/public',
  '/change-password'
] as const;

/** Where a partner session lands — on login, and on any `/` or blocked-page hit. */
export const PARTNER_HOME = '/partner';

export function isPartnerPath(pathname: string): boolean {
  return PARTNER_ALLOWED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * The portal's own module keys (Module Manager / sidebar entries).
 *
 * These get the same no-generic-isPrivileged-bypass treatment that
 * HR_RESTRICTED_KEYS and ACCOUNTS_RESTRICTED_KEYS already get in
 * lib/moduleConfigStore.ts — otherwise every 'manager' account in the
 * company would see the partner portal tiles, since isPrivileged is true for
 * all of them.
 */
export const PARTNER_PORTAL_MODULE_KEYS = [
  'partner-dashboard',
  'partner-projects',
  'partner-quotations',
  'partner-demos',
  'partner-support',
  'partner-materials'
] as const;

/** Nav section the partner-facing tiles live under. */
export const PARTNER_SECTION = 'Partner Portal';
