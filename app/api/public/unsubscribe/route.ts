import { NextRequest, NextResponse } from 'next/server';
import { BRAND } from '@/lib/branding';
import { escapeHtml } from '@/lib/email/templates/layout';
import { verifyUnsubscribe } from '@/lib/unsubscribeToken';
import { recordUnsubscribe } from '@/lib/festivalCampaignStore';

// PUBLIC (no session) — the unsubscribe link in client festival emails.
// The link carries the address plus an HMAC of it (lib/unsubscribeToken.ts),
// so it can only opt out the address it was sent to.
//
// GET only shows a confirm button; the opt-out happens on POST. Mail
// security scanners pre-fetch every link in a message, and a GET that
// unsubscribed would silently opt clients out before they ever read it.

function page(title: string, body: string, status = 200): NextResponse {
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>${escapeHtml(title)}</title></head>
<body style="margin:0; background:#f3f4f6; font-family:Arial, Helvetica, sans-serif;">
<div style="max-width:460px; margin:60px auto; background:#fff; border-radius:12px; padding:32px; text-align:center; box-shadow:0 2px 10px rgba(0,0,0,0.06);">
<div style="font-size:20px; font-weight:bold; letter-spacing:2px; color:#111827;">${escapeHtml(BRAND.companyName)}</div>
<h1 style="font-size:20px; color:#111827; margin:20px 0 12px;">${escapeHtml(title)}</h1>${body}
</div></body></html>`;
  return new NextResponse(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}

function readParams(request: NextRequest, form?: FormData): { email: string; token: string } {
  const email = String(form?.get('e') ?? request.nextUrl.searchParams.get('e') ?? '').trim().toLowerCase();
  const token = String(form?.get('t') ?? request.nextUrl.searchParams.get('t') ?? '').trim();
  return { email, token };
}

const INVALID = '<p style="color:#6b7280; font-size:14px;">This unsubscribe link is invalid or incomplete. Please use the link exactly as it appears in the email.</p>';

export async function GET(request: NextRequest) {
  const { email, token } = readParams(request);
  if (!verifyUnsubscribe(email, token)) return page('Link not valid', INVALID, 400);
  return page(
    'Unsubscribe from festival greetings?',
    `<p style="color:#374151; font-size:14px;">${escapeHtml(email)} will no longer receive festival greeting emails from ${escapeHtml(BRAND.companyLegalName)}.</p>
<form method="POST" action="/api/public/unsubscribe"><input type="hidden" name="e" value="${escapeHtml(email)}" /><input type="hidden" name="t" value="${escapeHtml(token)}" />
<button type="submit" style="margin-top:12px; background:#111827; color:#fff; border:0; border-radius:8px; padding:12px 24px; font-size:15px; cursor:pointer;">Unsubscribe</button></form>`
  );
}

export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => undefined);
  const { email, token } = readParams(request, form);
  if (!verifyUnsubscribe(email, token)) return page('Link not valid', INVALID, 400);
  try {
    await recordUnsubscribe(email);
  } catch {
    return page('Something went wrong', '<p style="color:#6b7280; font-size:14px;">Please try again in a few minutes.</p>', 500);
  }
  return page('You have been unsubscribed', `<p style="color:#374151; font-size:14px;">${escapeHtml(email)} will no longer receive festival greetings from us. Thank you for being our client.</p>`);
}
