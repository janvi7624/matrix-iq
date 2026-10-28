import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { testConnection, fetchLeadDetails, MetaGraphError } from '../../lib/metaGraphClient';

const PAGE_ID = '1234567890123456';
const PAGE_TOKEN = 'fake-page-token';

// Builds a fetch stub that answers each Graph API path with whatever the
// test configures — keyed on the path segment right after the API version,
// same shape testConnection()/fetchLeadDetails() actually request.
function mockGraph(responses: Record<string, { status?: number; body: unknown }>) {
  return vi.fn(async (url: string | URL) => {
    const path = new URL(url).pathname.replace(/^\/v\d+(\.\d+)?/, '');
    const match = Object.keys(responses).find((key) => path === key || path.endsWith(key));
    if (!match) throw new Error(`Unmocked Graph path: ${path}`);
    const { status = 200, body } = responses[match];
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  });
}

function oauthError(code: number, type: string, message: string) {
  return { status: 400, body: { error: { code, type, message } } };
}

beforeEach(() => {
  process.env.META_APP_ID = 'app-id';
  process.env.META_APP_SECRET = 'app-secret';
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.META_APP_ID;
  delete process.env.META_APP_SECRET;
});

describe('testConnection', () => {
  it('passes every check for a genuine, non-expiring Page token with full permissions', async () => {
    vi.stubGlobal(
      'fetch',
      mockGraph({
        '/me': { body: { id: PAGE_ID, name: 'Nanta Tech Limited' } },
        [`/${PAGE_ID}`]: { body: { id: PAGE_ID, name: 'Nanta Tech Limited' } },
        '/debug_token': { body: { data: { is_valid: true, scopes: ['leads_retrieval'], type: 'PAGE', expires_at: 0 } } },
        [`/${PAGE_ID}/subscribed_apps`]: { body: { data: [{ subscribed_fields: ['leadgen'] }] } }
      })
    );

    const result = await testConnection(PAGE_TOKEN, PAGE_ID);

    expect(result.ok).toBe(true);
    expect(result.checks.every((c) => c.ok)).toBe(true);
    expect(result.checks.find((c) => c.label === 'Token is a genuine Page token')).toMatchObject({ ok: true });
    expect(result.checks.find((c) => c.label === 'Token will not expire unexpectedly')).toMatchObject({ ok: true });
  });

  it('flags a User Access Token even though every other check passes — the exact "authenticates as a person" symptom', async () => {
    vi.stubGlobal(
      'fetch',
      mockGraph({
        '/me': { body: { id: 'user-999', name: 'Naval Bharti' } },
        [`/${PAGE_ID}`]: { body: { id: PAGE_ID, name: 'Nanta Tech Limited' } },
        '/debug_token': { body: { data: { is_valid: true, scopes: ['leads_retrieval'], type: 'USER', expires_at: 1_700_000_000 } } },
        [`/${PAGE_ID}/subscribed_apps`]: { body: { data: [{ subscribed_fields: ['leadgen'] }] } }
      })
    );

    const result = await testConnection(PAGE_TOKEN, PAGE_ID);

    expect(result.ok).toBe(false);
    const typeCheck = result.checks.find((c) => c.label === 'Token is a genuine Page token');
    expect(typeCheck?.ok).toBe(false);
    expect(typeCheck?.detail).toContain('authenticates as a person');
    expect(typeCheck?.detail).toContain('type: USER');
    expect(typeCheck?.detail).toContain('META_PAGE_ACCESS_TOKEN');
    // Expiry is only meaningful for a genuine Page token — a USER-type
    // mismatch shouldn't also claim an unrelated expiry verdict.
    expect(result.checks.find((c) => c.label === 'Token will not expire unexpectedly')).toBeUndefined();
  });

  it('flags a genuine Page token that is short-lived', async () => {
    const expiresAt = 1_735_000_000;
    vi.stubGlobal(
      'fetch',
      mockGraph({
        '/me': { body: { id: PAGE_ID, name: 'Nanta Tech Limited' } },
        [`/${PAGE_ID}`]: { body: { id: PAGE_ID, name: 'Nanta Tech Limited' } },
        '/debug_token': { body: { data: { is_valid: true, scopes: ['leads_retrieval'], type: 'PAGE', expires_at: expiresAt } } },
        [`/${PAGE_ID}/subscribed_apps`]: { body: { data: [{ subscribed_fields: ['leadgen'] }] } }
      })
    );

    const result = await testConnection(PAGE_TOKEN, PAGE_ID);

    expect(result.ok).toBe(false);
    const expiryCheck = result.checks.find((c) => c.label === 'Token will not expire unexpectedly');
    expect(expiryCheck?.ok).toBe(false);
    expect(expiryCheck?.detail).toContain(new Date(expiresAt * 1000).toISOString());
    expect(expiryCheck?.detail).toContain('long-lived token');
  });

  it('surfaces the exact expired/invalid-token message and short-circuits on the very first check', async () => {
    vi.stubGlobal('fetch', mockGraph({ '/me': oauthError(190, 'OAuthException', 'Error validating access token') }));

    const result = await testConnection(PAGE_TOKEN, PAGE_ID);

    expect(result.ok).toBe(false);
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0]).toMatchObject({
      label: 'Credentials valid',
      ok: false,
      detail: 'The Meta access token is invalid or has expired. Reconnect via Meta Business Suite and update META_PAGE_ACCESS_TOKEN.'
    });
  });

  it('surfaces a missing-permission error distinctly from an expired token', async () => {
    vi.stubGlobal(
      'fetch',
      mockGraph({
        '/me': { body: { id: PAGE_ID, name: 'Nanta Tech Limited' } },
        [`/${PAGE_ID}`]: oauthError(200, 'OAuthException', 'Permissions error')
      })
    );

    const result = await testConnection(PAGE_TOKEN, PAGE_ID);

    expect(result.ok).toBe(false);
    expect(result.checks).toHaveLength(2);
    expect(result.checks[1]).toMatchObject({ label: 'Page accessible' });
    expect(result.checks[1].ok).toBe(false);
    expect(result.checks[1].detail).toContain('missing a required permission');
  });

  it('flags a missing leads_retrieval scope separately from token type/expiry', async () => {
    vi.stubGlobal(
      'fetch',
      mockGraph({
        '/me': { body: { id: PAGE_ID, name: 'Nanta Tech Limited' } },
        [`/${PAGE_ID}`]: { body: { id: PAGE_ID, name: 'Nanta Tech Limited' } },
        '/debug_token': { body: { data: { is_valid: true, scopes: ['pages_show_list'], type: 'PAGE', expires_at: 0 } } },
        [`/${PAGE_ID}/subscribed_apps`]: { body: { data: [{ subscribed_fields: ['leadgen'] }] } }
      })
    );

    const result = await testConnection(PAGE_TOKEN, PAGE_ID);

    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.label === 'Lead access available')).toMatchObject({ ok: false });
    expect(result.checks.find((c) => c.label === 'Token is a genuine Page token')).toMatchObject({ ok: true });
  });

  it('flags a Page not yet subscribed to leadgen events', async () => {
    vi.stubGlobal(
      'fetch',
      mockGraph({
        '/me': { body: { id: PAGE_ID, name: 'Nanta Tech Limited' } },
        [`/${PAGE_ID}`]: { body: { id: PAGE_ID, name: 'Nanta Tech Limited' } },
        '/debug_token': { body: { data: { is_valid: true, scopes: ['leads_retrieval'], type: 'PAGE', expires_at: 0 } } },
        [`/${PAGE_ID}/subscribed_apps`]: { body: { data: [{ subscribed_fields: ['feed'] }] } }
      })
    );

    const result = await testConnection(PAGE_TOKEN, PAGE_ID);

    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.label === 'Webhook configured')).toMatchObject({ ok: false });
  });

  it('reports a rate-limit error as retryable rather than as an auth failure', async () => {
    vi.stubGlobal('fetch', mockGraph({ '/me': oauthError(4, 'OAuthException', 'Application request limit reached') }));

    const result = await testConnection(PAGE_TOKEN, PAGE_ID);

    expect(result.checks[0].detail).toContain('rate limit');
  });
});

describe('fetchLeadDetails', () => {
  const LEADGEN_ID = '9999999999999999';
  const FORM_ID = '8888888888888888';

  it('fetches field data and resolves the form name', async () => {
    vi.stubGlobal(
      'fetch',
      mockGraph({
        [`/${LEADGEN_ID}`]: {
          body: {
            id: LEADGEN_ID,
            created_time: '2026-10-01T00:00:00+0000',
            campaign_id: 'c1',
            campaign_name: 'Diwali Promo',
            form_id: FORM_ID,
            platform: 'facebook',
            field_data: [{ name: 'full_name', values: ['Jane Doe'] }]
          }
        },
        [`/${FORM_ID}`]: { body: { name: 'Contact Us Form' } }
      })
    );

    const details = await fetchLeadDetails(LEADGEN_ID, PAGE_TOKEN);

    expect(details.leadId).toBe(LEADGEN_ID);
    expect(details.formName).toBe('Contact Us Form');
    expect(details.platform).toBe('fb');
    expect(details.campaignName).toBe('Diwali Promo');
  });

  it('still returns the lead when the form-name lookup fails', async () => {
    vi.stubGlobal(
      'fetch',
      mockGraph({
        [`/${LEADGEN_ID}`]: { body: { id: LEADGEN_ID, form_id: FORM_ID, field_data: [] } },
        [`/${FORM_ID}`]: oauthError(200, 'OAuthException', 'Permissions error')
      })
    );

    const details = await fetchLeadDetails(LEADGEN_ID, PAGE_TOKEN);

    expect(details.leadId).toBe(LEADGEN_ID);
    expect(details.formName).toBe('');
  });

  it('throws a classified expired_token error when Meta returns error code 190', async () => {
    vi.stubGlobal('fetch', mockGraph({ [`/${LEADGEN_ID}`]: oauthError(190, 'OAuthException', 'Error validating access token') }));

    await expect(fetchLeadDetails(LEADGEN_ID, PAGE_TOKEN)).rejects.toMatchObject({
      kind: 'expired_token',
      message: 'The Meta access token is invalid or has expired. Reconnect via Meta Business Suite and update META_PAGE_ACCESS_TOKEN.'
    } as Partial<MetaGraphError>);
  });

  it('throws a classified invalid_lead_id error for a lead outside Meta’s retention window', async () => {
    vi.stubGlobal(
      'fetch',
      mockGraph({ [`/${LEADGEN_ID}`]: { status: 400, body: { error: { type: 'GraphMethodException', message: 'Unsupported get request.' } } } })
    );

    await expect(fetchLeadDetails(LEADGEN_ID, PAGE_TOKEN)).rejects.toMatchObject({ kind: 'invalid_lead_id' });
  });
});
