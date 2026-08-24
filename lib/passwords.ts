import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return `${salt}:${derivedKey.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hashHex] = stored.split(':');
  if (!salt || !hashHex) return false;
  const hashBuffer = Buffer.from(hashHex, 'hex');
  const derivedKey = (await scrypt(password, salt, hashBuffer.length || KEY_LENGTH)) as Buffer;
  if (hashBuffer.length !== derivedKey.length) return false;
  return timingSafeEqual(hashBuffer, derivedKey);
}

// Random temporary password for admin-issued credentials (Excel import,
// resend-welcome-email) — excludes visually ambiguous characters (0/O, 1/l/I)
// since these get read off an email and typed in by hand.
const AMBIGUOUS_CHARS = /[0O1lI]/g;
export function generateTempPassword(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(10);
  let out = '';
  for (let i = 0; i < 10; i++) out += alphabet[bytes[i] % alphabet.length];
  return out.replace(AMBIGUOUS_CHARS, () => alphabet[randomBytes(1)[0] % alphabet.length]);
}
