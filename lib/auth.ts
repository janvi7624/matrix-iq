// Uses the Web Crypto API (globalThis.crypto.subtle) so this works whether the
// caller runs in the Node.js or Edge runtime (Next.js 16 Proxy defaults to Node,
// but this stays portable either way).
import type { NextRequest } from 'next/server';
import { UserRole } from './types';
import { SESSION_IDLE_MS } from './sessionTimeout';

export const SESSION_COOKIE = 'nanta_session';

// A session now dies two ways, and the enforcement for both is here rather
// than in the browser, where it could simply be ignored:
//
//  1. Idle. The signed token is only valid for SESSION_IDLE_MS, so a session
//     left untouched stops working — the server rejects it, whatever the page
//     does. An actively-used session is renewed well before that by
//     POST /api/auth/heartbeat, which the client fires on real interaction
//     (see components/SessionTimeoutWatcher.tsx); renewal deliberately is NOT
//     driven by requests, because a background poller — the notification bell
//     polls every 60s — would otherwise keep an abandoned screen signed in
//     forever.
//  2. Browser closed. The cookie is a session cookie (no Max-Age/Expires, see
//     sessionCookieOptions), so closing the browser discards it.
// The window itself lives in lib/sessionTimeout.ts, which has no imports, so
// the browser can share the number without bundling this file's signing code.
export { SESSION_IDLE_MS, SESSION_WARN_BEFORE_MS } from './sessionTimeout';

const SESSION_TTL_MS = SESSION_IDLE_MS;

// Every place that sets this cookie must set it the same way; a stray maxAge
// on one of them would quietly make that path's session outlive the browser.
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/'
    // No maxAge/expires on purpose — see (2) above.
  };
}

const encoder = new TextEncoder();

export interface SessionPayload {
  sub: string;
  username: string;
  role: UserRole;
  exp: number;
  // True only for accounts created via bulk employee import until the
  // employee changes their temporary password — proxy.ts uses this to lock
  // the account to /change-password without a DB lookup on every request.
  mustChangePassword?: boolean;
  // Whether this role reaches /admin/* etc (Role Management's isPrivileged
  // flag), computed ONCE at login/token-reissue and baked into the signed
  // token rather than re-resolved from the DB on every request. proxy.ts
  // (Next's "Proxy"/middleware) cannot reliably load native DB drivers under
  // this app's Turbopack build — see the comment in proxy.ts — so this claim
  // is what lets it gate /admin/* without touching Sequelize. Trade-off: if
  // an admin flips a role's isPrivileged flag, an already-logged-in user of
  // that role only sees the change after their token is reissued (next
  // login, or their next password change) — same staleness class this app
  // already accepts for the `role` claim itself.
  isPrivileged: boolean;
  /**
   * May this account reach Partner Management despite not being privileged?
   *
   * Partner accounts are brought in by ordinary sales staff on the generic
   * 'user' role, but Partner Management lives under /admin/partners, which
   * proxy.ts gates on isPrivileged. Rather than making those people admins —
   * which would hand them User Management, Role Management and every other
   * /admin screen — this one claim opens exactly the partner routes.
   *
   * Resolved from AppConfig.partnerCreatorIds at login and baked into the
   * signed token, for the same reason isPrivileged is: proxy.ts cannot load
   * Sequelize. Same staleness trade-off too — somebody added to the list
   * sees it from their next login.
   */
  partnerCreator?: boolean;
  // Which external partner company this account belongs to, or undefined for
  // every internal employee. Baked into the signed token at login/reissue for
  // exactly the same reason isPrivileged is (see above): proxy.ts has to
  // decide whether a request may leave the /partner/* route area, and it
  // cannot load Sequelize to ask the database.
  //
  // What this claim is and is NOT:
  //   IS  — a route-area gate ("is this session confined to the portal").
  //   NOT — the authorization used to read partner data. Every partner route
  //         re-resolves the binding live through lib/partnerContext.ts, which
  //         also checks the partner company's current status, so suspending a
  //         partner takes effect on their next request instead of at their
  //         next login. The staleness this claim accepts is the same class
  //         already accepted for `role` and `isPrivileged`, and it is safe
  //         here only because nothing reads tenant data off it.
  partnerId?: string;
  /**
   * Server-side revocation hook, found missing in an attack pass: this token
   * scheme is otherwise 100% stateless, so neither logout nor a password
   * change could ever kill an already-issued token before its own expiry.
   *
   * Rather than adding a new column (this app's only datastore is Postgres,
   * and a schema migration wasn't available when this was fixed), this reuses
   * users.lastLoginAt — already written exactly once per login — as a
   * "session epoch": the epoch-ms value of lastLoginAt at the moment this
   * token was issued. lib/viewerContext.ts/app/api/auth/me re-check this
   * against the LIVE column value on every request; a mismatch means some
   * later action re-stamped it, so this token is deliberately dead.
   *
   * Only two actions touch that column after the initial login that creates
   * it: logout and password change (see lib/userStore.ts's touchSessionEpoch)
   * — both re-stamp it to invalidate every token issued before that moment,
   * which also means logging out on one device signs the account out
   * everywhere. That's an accepted simplification, not an oversight: this
   * app has no concept of distinguishing one active session from another to
   * revoke individually.
   */
  sessionEpoch: number;
}

function toBase64Url(bytes: ArrayBuffer): string {
  let binary = '';
  new Uint8Array(bytes).forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function getSigningKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function createSessionToken(user: {
  id: string;
  username: string;
  role: UserRole;
  mustChangePassword?: boolean;
  isPrivileged: boolean;
  partnerCreator?: boolean;
  partnerId?: string | null;
  // The live users.lastLoginAt value (as epoch ms) at the moment of issuance
  // — see SessionPayload.sessionEpoch. Every caller of this function must
  // pass the value it just wrote/read from the DB, not a freshly-computed
  // Date.now(), or the token will immediately fail its own revocation check.
  sessionEpoch: number;
}): Promise<string> {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) throw new Error('ADMIN_SESSION_SECRET is not configured');
  const payload: SessionPayload = {
    sub: user.id,
    username: user.username,
    role: user.role,
    exp: Date.now() + SESSION_TTL_MS,
    mustChangePassword: user.mustChangePassword || undefined,
    isPrivileged: user.isPrivileged,
    sessionEpoch: user.sessionEpoch,
    // Omitted entirely when false, so an ordinary token keeps the exact shape
    // this app already issued.
    partnerCreator: user.partnerCreator || undefined,
    // `|| undefined` so an internal account's token carries no partner key at
    // all, rather than an explicit null — keeps existing tokens and internal
    // ones byte-identical in shape to what this app already issued.
    partnerId: user.partnerId || undefined
  };
  const payloadJson = toBase64Url(encoder.encode(JSON.stringify(payload)).buffer as ArrayBuffer);
  const key = await getSigningKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payloadJson));
  return `${payloadJson}.${toBase64Url(signature)}`;
}

export async function verifySessionToken(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token) return null;
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) return null;

  const [payloadJson, signature] = token.split('.');
  if (!payloadJson || !signature) return null;

  try {
    const key = await getSigningKey(secret);
    const signatureBytes = fromBase64Url(signature);
    const valid = await crypto.subtle.verify('HMAC', key, signatureBytes.buffer as ArrayBuffer, encoder.encode(payloadJson));
    if (!valid) return null;

    const payload: SessionPayload = JSON.parse(new TextDecoder().decode(fromBase64Url(payloadJson)));
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

// Convenience for route handlers that need role-aware logic beyond what
// proxy.ts's coarse gating covers (e.g. "only superadmin may do X").
export async function getSessionFromRequest(request: NextRequest): Promise<SessionPayload | null> {
  return verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
}

// Pure comparison — no DB access, safe for proxy.ts too if it's ever needed
// there — shared by every call site that resolves the LIVE lastLoginAt
// value (see SessionPayload.sessionEpoch) and needs to decide whether this
// token is still the current one or was revoked by a later logout/password
// change. `null`/`undefined` liveEpoch (an account that somehow has never
// recorded a login) or a token issued before this check existed (no
// sessionEpoch claim at all) both pass — there is nothing live to compare
// against, so there is nothing to revoke.
export function isSessionEpochCurrent(session: SessionPayload, liveEpochMs: number | null | undefined): boolean {
  if (session.sessionEpoch == null || liveEpochMs == null) return true;
  // Exact match, not a tolerance window: both sides read the SAME stored
  // value (the token embeds exactly what recordLogin/touchSessionEpoch just
  // wrote; the live side reads that same column back), so there is no
  // independent-clock drift to absorb. An early version of this used a 1s
  // tolerance "for driver rounding" and it masked a real revocation —
  // logging out immediately after login left the old and new epoch within
  // that window, so the just-logged-out token kept authenticating. Postgres
  // round-trips a JS Date through its timestamp column losing nothing at
  // millisecond precision, so exact equality is the correct check.
  return session.sessionEpoch === liveEpochMs;
}
