import { NextRequest } from 'next/server';

// Best-effort client IP for the audit log — reverse proxies typically set
// x-forwarded-for; NextRequest has no reliable .ip in the Node runtime, so
// this returns '' when nothing usable is present rather than guessing.
export function getClientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) return forwardedFor.split(',')[0].trim();
  return request.headers.get('x-real-ip') || '';
}
