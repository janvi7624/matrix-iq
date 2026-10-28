import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import { NextRequest } from 'next/server';

// Exercises the webhook route's own inline logic that nothing else in the
// app duplicates: the GET verification handshake, the HMAC-SHA256 signature
// check on POST (computed over Meta's raw bytes, not a re-serialized body),
// and the large-Meta-id JSON protection — plus that a validly-signed
// leadgen event is actually handed to ingestMetaLead with the right ids.
// The ingestion pipeline itself (dedup/retry/assignment) is covered in
// metaLeadIngest.test.ts; this file stubs it out.

vi.mock('@/lib/metaConfig', () => ({ getMetaEnvConfig: vi.fn() }));
vi.mock('@/lib/metaIntegrationConfigStore', () => ({ markWebhookVerified: vi.fn(), touchWebhookReceived: vi.fn() }));
vi.mock('@/lib/metaLeadIngest', () => ({ ingestMetaLead: vi.fn(async () => ({ status: 'created', leadId: 'lead-1' })) }));

import { getMetaEnvConfig } from '@/lib/metaConfig';
import { markWebhookVerified, touchWebhookReceived } from '@/lib/metaIntegrationConfigStore';
import { ingestMetaLead } from '@/lib/metaLeadIngest';
import { GET, POST } from '../../app/api/integrations/meta/webhook/route';

const envMock = vi.mocked(getMetaEnvConfig);
const APP_SECRET = 'top-secret';
const VERIFY_TOKEN = 'my-verify-token';

function signedBody(body: string): string {
  return 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(body, 'utf8').digest('hex');
}

beforeEach(() => {
  vi.clearAllMocks();
  envMock.mockReturnValue({ appId: 'app-id', appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN, pageId: 'page-1', pageAccessToken: 'token-1' });
});

describe('GET — webhook verification handshake', () => {
  it('echoes the challenge and marks the webhook verified when the token matches', async () => {
    const req = new NextRequest(
      `https://app.example.com/api/integrations/meta/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=abc123`
    );

    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('abc123');
    expect(markWebhookVerified).toHaveBeenCalledTimes(1);
  });

  it('rejects with 403 and never marks verified when the token does not match', async () => {
    const req = new NextRequest(
      'https://app.example.com/api/integrations/meta/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc123'
    );

    const res = await GET(req);

    expect(res.status).toBe(403);
    expect(markWebhookVerified).not.toHaveBeenCalled();
  });

  it('rejects when no verify token is configured at all', async () => {
    envMock.mockReturnValue({ appId: '', appSecret: '', verifyToken: '', pageId: '', pageAccessToken: '' });
    const req = new NextRequest(
      `https://app.example.com/api/integrations/meta/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=abc123`
    );

    const res = await GET(req);

    expect(res.status).toBe(403);
  });
});

describe('POST — signature verification and lead-event dispatch', () => {
  it('processes a validly-signed leadgen event and hands it to ingestMetaLead', async () => {
    const body = JSON.stringify({
      object: 'page',
      entry: [{ id: 'page-1', time: 1, changes: [{ field: 'leadgen', value: { leadgen_id: '555', page_id: 'page-1', form_id: 'form-1' } }] }]
    });
    const req = new NextRequest('https://app.example.com/api/integrations/meta/webhook', {
      method: 'POST',
      headers: { 'x-hub-signature-256': signedBody(body) },
      body
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(touchWebhookReceived).toHaveBeenCalledTimes(1);
    expect(ingestMetaLead).toHaveBeenCalledTimes(1);
    expect(ingestMetaLead).toHaveBeenCalledWith('555', { pageId: 'page-1', formId: 'form-1', rawPayloadForLog: { leadgen_id: '555', page_id: 'page-1', form_id: 'form-1' } });
  });

  it('rejects an incorrectly signed payload with 403 and never touches ingestMetaLead', async () => {
    const body = JSON.stringify({ object: 'page', entry: [] });
    const req = new NextRequest('https://app.example.com/api/integrations/meta/webhook', {
      method: 'POST',
      headers: { 'x-hub-signature-256': 'sha256=0000000000000000000000000000000000000000000000000000000000000000' },
      body
    });

    const res = await POST(req);

    expect(res.status).toBe(403);
    expect(ingestMetaLead).not.toHaveBeenCalled();
    expect(touchWebhookReceived).not.toHaveBeenCalled();
  });

  it('rejects when no app secret is configured, rather than trusting an unsigned payload', async () => {
    envMock.mockReturnValue({ appId: '', appSecret: '', verifyToken: VERIFY_TOKEN, pageId: 'page-1', pageAccessToken: 'token-1' });
    const body = JSON.stringify({ object: 'page', entry: [] });
    const req = new NextRequest('https://app.example.com/api/integrations/meta/webhook', { method: 'POST', body });

    const res = await POST(req);

    expect(res.status).toBe(403);
    expect(ingestMetaLead).not.toHaveBeenCalled();
  });

  it('preserves a 17-digit leadgen_id exactly instead of letting JSON.parse round it', async () => {
    const bigId = '12345678901234567';
    const body = `{"object":"page","entry":[{"id":"page-1","changes":[{"field":"leadgen","value":{"leadgen_id":${bigId},"page_id":"page-1"}}]}]}`;
    const req = new NextRequest('https://app.example.com/api/integrations/meta/webhook', {
      method: 'POST',
      headers: { 'x-hub-signature-256': signedBody(body) },
      body
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(ingestMetaLead).toHaveBeenCalledWith(bigId, expect.objectContaining({ pageId: 'page-1' }));
  });

  it('acks 200 on malformed JSON in an otherwise correctly-signed request, without calling ingestMetaLead', async () => {
    const body = '{not valid json';
    const req = new NextRequest('https://app.example.com/api/integrations/meta/webhook', {
      method: 'POST',
      headers: { 'x-hub-signature-256': signedBody(body) },
      body
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(ingestMetaLead).not.toHaveBeenCalled();
  });
});
