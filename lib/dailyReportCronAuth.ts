// Constant-time string comparison for the scheduler's shared secret.
//
// A plain `a === b` on a secret returns as soon as it finds a differing
// byte, which leaks the length of the matching prefix to anyone who can
// measure response times across many attempts — enough to recover a secret
// one character at a time. This always touches every byte.
//
// Implemented against the Web Crypto-era globals rather than node:crypto's
// timingSafeEqual so the module stays runtime-agnostic (the same reason
// lib/auth.ts signs with crypto.subtle), and because timingSafeEqual throws
// on length mismatch, which would reintroduce a length oracle.
export function timingSafeEqualString(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  // Length difference is folded into the accumulator instead of
  // short-circuiting, so a wrong-length guess costs the same as a
  // right-length one.
  let diff = left.length ^ right.length;
  const max = Math.max(left.length, right.length);
  for (let i = 0; i < max; i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}
