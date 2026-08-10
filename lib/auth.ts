// Uses the Web Crypto API (globalThis.crypto.subtle) so this works whether the
// caller runs in the Node.js or Edge runtime (Next.js 16 Proxy defaults to Node,
// but this stays portable either way).
import type { NextRequest } from 'next/server';
import { UserRole } from './types';

export const SESSION_COOKIE = 'nanta_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

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
