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

export async function createSessionToken(user: { id: string; username: string; role: UserRole }): Promise<string> {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) throw new Error('ADMIN_SESSION_SECRET is not configured');
  const payload: SessionPayload = {
    sub: user.id,
    username: user.username,
    role: user.role,
    exp: Date.now() + SESSION_TTL_MS
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
