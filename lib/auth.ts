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

export async function createSessionToken(user: { id: string; username: string; role: UserRole; mustChangePassword?: boolean; isPrivileged: boolean }): Promise<string> {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) throw new Error('ADMIN_SESSION_SECRET is not configured');
  const payload: SessionPayload = {
    sub: user.id,
    username: user.username,
    role: user.role,
    exp: Date.now() + SESSION_TTL_MS,
    mustChangePassword: user.mustChangePassword || undefined,
    isPrivileged: user.isPrivileged
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
