// A CDN sitting in front of this app (Hostinger's hcdn) caches statically
// prerendered HTML per exact URL for up to a year (Cache-Control:
// s-maxage=31536000) — fine for content that never changes, but this page's
// HTML embeds references to content-hashed build chunk filenames that DO
// change on every deploy. A cached copy from before a deploy points at
// chunks that no longer exist after it, so the browser's JS never loads and
// the page renders blank (reproduced: /login?next=%2F served stale HTML
// referencing pre-redeploy chunk hashes). Forcing this route dynamic
// (server-rendered per request, not prerendered at build time) means the
// CDN can no longer cache a single "forever" copy of it, closing that gap —
// verified: Cache-Control changes from `s-maxage=31536000` to `private,
// no-cache, no-store, max-age=0, must-revalidate`. Route segment config like
// `dynamic` only works from a Server Component, so the actual page — a
// 'use client' component, since it uses useSearchParams()/useState — lives
// in LoginPageClient instead of directly in this file.
export const dynamic = 'force-dynamic';

import LoginPageClient from './LoginPageClient';

export default function LoginPage() {
  return <LoginPageClient />;
}
