import { createHmac, timingSafeEqual } from 'node:crypto';

// Signed one-click unsubscribe links for bulk client mail. The token is an
// HMAC of the normalized address, so a link can only opt out the address it
// was sent to — nobody can unsubscribe an arbitrary client by editing the URL.
//
// Keyed on UNSUBSCRIBE_SECRET, falling back to ADMIN_SESSION_SECRET (always
// set on a working deployment). With neither set, signing returns '' and
// verification always fails — closed, not open.

function secret(): string {
  return process.env.UNSUBSCRIBE_SECRET || process.env.ADMIN_SESSION_SECRET || '';
}

export function signUnsubscribe(email: string, key: string = secret()): string {
  if (!key) return '';
  return createHmac('sha256', key).update(`unsubscribe:${email.trim().toLowerCase()}`).digest('base64url');
}

export function verifyUnsubscribe(email: string, token: string, key: string = secret()): boolean {
  if (!key || !email || !token) return false;
  const expected = Buffer.from(signUnsubscribe(email, key));
  const supplied = Buffer.from(token);
  if (expected.length !== supplied.length) return false;
  return timingSafeEqual(expected, supplied);
}

export function buildUnsubscribeUrl(appUrl: string, email: string): string {
  const token = signUnsubscribe(email);
  if (!appUrl || !token) return '';
  const params = new URLSearchParams({ e: email.trim().toLowerCase(), t: token });
  return `${appUrl}/api/public/unsubscribe?${params.toString()}`;
}
