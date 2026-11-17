import { NextRequest, NextResponse } from 'next/server';
import { getClientIp } from '@/lib/requestIp';
import { ingestDemoRequest } from '@/lib/demoRequestIntake';
import { INTEREST_OPTIONS, TEAM_SIZE_OPTIONS } from '@/lib/landingContent';

// PUBLIC (no session) — the website's "Request a demo" form. Guarded by a
// honeypot field, a per-IP rate limit and strict field validation. The reply
// is the same whether the lead was new or merged, so it reveals nothing about
// who is already a customer.

const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (!v.some((t) => now - t < WINDOW_MS)) hits.delete(k);
  }
  return recent.length > MAX_PER_WINDOW;
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  // Honeypot: real visitors never see or fill this field. Pretend success.
  if (str(body.website, 200)) return NextResponse.json({ ok: true });

  const ip = getClientIp(request) || 'unknown';
  if (rateLimited(ip)) {
    return NextResponse.json({ error: 'Too many requests. Please try again later, or call us.' }, { status: 429 });
  }

  const name = str(body.name, 120);
  const company = str(body.company, 160);
  const email = str(body.email, 160).toLowerCase();
  const mobileDigits = str(body.mobile, 30).replace(/[^\d+]/g, '');
  const errors: Record<string, string> = {};
  if (name.length < 2) errors.name = 'Please enter your name.';
  if (company.length < 2) errors.company = 'Please enter your company.';
  if (!EMAIL_RE.test(email)) errors.email = 'Please enter a valid email.';
  if (mobileDigits.replace(/\D/g, '').length < 8 || mobileDigits.replace(/\D/g, '').length > 15) errors.mobile = 'Please enter a valid mobile number.';
  if (body.consent !== true) errors.consent = 'Please agree to be contacted.';
  if (Object.keys(errors).length) return NextResponse.json({ error: 'Please check the highlighted fields.', fields: errors }, { status: 400 });

  const interests = Array.isArray(body.interests) ? body.interests.filter((i: unknown): i is string => typeof i === 'string' && INTEREST_OPTIONS.includes(i)) : [];
  const teamSize = TEAM_SIZE_OPTIONS.includes(body.teamSize) ? (body.teamSize as string) : '';
  const preferredDate = /^\d{4}-\d{2}-\d{2}$/.test(str(body.preferredDate, 10)) ? str(body.preferredDate, 10) : '';

  try {
    await ingestDemoRequest(
      {
        name,
        company,
        mobile: mobileDigits,
        email,
        designation: str(body.designation, 120),
        city: str(body.city, 80),
        teamSize,
        interests,
        preferredDate,
        message: typeof body.message === 'string' ? body.message.trim().slice(0, 2000) : ''
      },
      ip
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[demo-request] failed:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Something went wrong. Please call or email us instead.' }, { status: 500 });
  }
}
