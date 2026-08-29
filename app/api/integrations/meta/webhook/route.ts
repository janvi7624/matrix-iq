import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getMetaEnvConfig } from '@/lib/metaConfig';
import { markWebhookVerified, touchWebhookReceived } from '@/lib/metaIntegrationConfigStore';
import { ingestMetaLead } from '@/lib/metaLeadIngest';

// Meta's webhook GET verification handshake — sent once when the webhook
// is configured (and again any time it's re-verified) in the Meta
// Developer Console. This route is excluded from proxy.ts's session-cookie
// requirement (see PUBLIC_PATHS there) since Meta's servers never carry a
// MatrixIQ session — this handshake IS the authenticity check for GET.
export async function GET(request: NextRequest) {
  const env = getMetaEnvConfig();
  const mode = request.nextUrl.searchParams.get('hub.mode');
  const token = request.nextUrl.searchParams.get('hub.verify_token');
  const challenge = request.nextUrl.searchParams.get('hub.challenge');

  if (!env.verifyToken || mode !== 'subscribe' || !token || token !== env.verifyToken || !challenge) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  await markWebhookVerified();
  return new NextResponse(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
}

interface LeadgenChangeValue {
  leadgen_id?: string;
  page_id?: string;
  form_id?: string;
  adgroup_id?: string;
  ad_id?: string;
  created_time?: number;
}

interface MetaWebhookPayload {
  object?: string;
  entry?: {
    id?: string;
    time?: number;
    changes?: { field?: string; value?: LeadgenChangeValue }[];
  }[];
}

// Meta's webhook payload sends leadgen_id/page_id/form_id/adgroup_id/ad_id
// as RAW, UNQUOTED JSON numbers (confirmed against Meta's own documented
// example payload) — not as strings, unlike Graph API responses elsewhere
// in this integration (lib/metaGraphClient.ts), which Meta does quote.
// Real Facebook/Meta object ids are commonly 15-17 digits, which exceeds
// Number.MAX_SAFE_INTEGER (16 digits) — plain JSON.parse silently rounds
// them (verified: 12345678901234567 becomes 12345678901234568), corrupting
// the exact id used for both the Graph API lookup and the
// leads.meta_lead_id idempotency key. This wraps any bare 10+-digit number
// immediately after one of those known id field names in quotes BEFORE
// parsing, so it round-trips as an exact string instead. Applied AFTER
// signature verification (which must run over Meta's untouched bytes) and
// only changes the object JSON.parse produces, never the bytes verified.
const LARGE_ID_FIELD_PATTERN = /"(leadgen_id|page_id|form_id|adgroup_id|ad_id)":\s*(\d{10,})/g;

function protectLargeIdFields(raw: string): string {
  return raw.replace(LARGE_ID_FIELD_PATTERN, '"$1":"$2"');
}

// POST — the actual lead event notification. Never trust an unsigned or
// incorrectly-signed payload (spec section 6) — the raw body must be read
// BEFORE any JSON parsing, since the signature is computed over the exact
// bytes Meta sent, not a re-serialized version of the parsed object.
export async function POST(request: NextRequest) {
  const env = getMetaEnvConfig();
  const rawBody = await request.text();

  if (!env.appSecret) {
    // Nothing to verify a signature against — refuse rather than silently
    // trust an unsigned payload.
    return NextResponse.json({ error: 'Meta integration not configured' }, { status: 403 });
  }

  const signatureHeader = request.headers.get('x-hub-signature-256') || '';
  const expected = 'sha256=' + crypto.createHmac('sha256', env.appSecret).update(rawBody, 'utf8').digest('hex');
  const signatureBuf = Buffer.from(signatureHeader);
  const expectedBuf = Buffer.from(expected);
  const validSignature = signatureBuf.length === expectedBuf.length && crypto.timingSafeEqual(signatureBuf, expectedBuf);
  if (!validSignature) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
  }

  let payload: MetaWebhookPayload;
  try {
    payload = JSON.parse(protectLargeIdFields(rawBody));
  } catch {
    // Malformed JSON from an otherwise correctly-signed request — ack 200
    // anyway (nothing useful to retry) rather than making Meta hammer this
    // endpoint with retries for a payload that will never parse.
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  await touchWebhookReceived();

  const leadgenEvents = (payload.entry || []).flatMap((entry) =>
    (entry.changes || [])
      .filter((change) => change.field === 'leadgen' && change.value?.leadgen_id)
      .map((change) => ({ value: change.value as LeadgenChangeValue, entryId: entry.id }))
  );

  // Process inline (no background queue exists in this app) but never let
  // one bad lead's failure affect another's, or throw back to Meta — every
  // failure is captured in meta_webhook_events for "Sync Meta Leads" to
  // recover, not surfaced as a non-200 response (which would just make
  // Meta retry the whole batch, including leads that already succeeded).
  for (const { value } of leadgenEvents) {
    try {
      await ingestMetaLead(value.leadgen_id as string, {
        pageId: value.page_id,
        formId: value.form_id,
        rawPayloadForLog: value
      });
    } catch (err) {
      // ingestMetaLead persists failure state to meta_webhook_events for
      // any failure it can reach a database for — this catch only guards
      // against a truly unexpected throw before/around that (e.g. the
      // database itself is briefly unavailable), so the webhook handler
      // never 500s back to Meta. That specific case can't be written to
      // meta_webhook_events (the DB is what's failing), so it's logged
      // server-side instead — otherwise it would leave zero trace anywhere.
      // Never logs payload contents (may include a lead's personal data),
      // only the id needed to look it up and the error itself.
      console.error(`[meta-webhook] Failed to process leadgen_id=${value.leadgen_id}:`, err instanceof Error ? err.message : err);
    }
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
