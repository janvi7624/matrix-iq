import { describe, it, expect, vi, beforeEach } from 'vitest';

// ingestMetaLead is the single shared pipeline behind both the real-time
// webhook and the manual "Sync Meta Leads" backfill — this pins the
// guarantees both entry points rely on: a lead is never created twice for
// the same leadgen_id (neither via the pre-check nor via the DB-level race),
// a transient Graph failure gets exactly one retry, and a non-retryable
// failure (expired/invalid token, missing permission) is not retried.

vi.mock('../../lib/metaConfig', () => ({ getMetaEnvConfig: vi.fn() }));
vi.mock('../../lib/leadStore', () => ({ createOrMergeLead: vi.fn(), findLeadByMetaLeadId: vi.fn() }));
vi.mock('../../lib/userStore', () => ({ findUserById: vi.fn() }));
vi.mock('../../lib/auditLogStore', () => ({ logAudit: vi.fn() }));
vi.mock('../../lib/notificationStore', () => ({ notifyUsers: vi.fn() }));
vi.mock('../../lib/metaIntegrationConfigStore', () => ({ getMetaIntegrationConfig: vi.fn(), resolveNextRoundRobinOwnerId: vi.fn() }));
vi.mock('../../lib/metaGraphClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/metaGraphClient')>();
  return { ...actual, fetchLeadDetails: vi.fn() };
});

const m = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('../../lib/db', () => ({ db: { MetaWebhookEvent: { create: m.create } } }));

import { getMetaEnvConfig } from '../../lib/metaConfig';
import { createOrMergeLead, findLeadByMetaLeadId } from '../../lib/leadStore';
import { findUserById } from '../../lib/userStore';
import { notifyUsers } from '../../lib/notificationStore';
import { getMetaIntegrationConfig, resolveNextRoundRobinOwnerId } from '../../lib/metaIntegrationConfigStore';
import { fetchLeadDetails, MetaGraphError } from '../../lib/metaGraphClient';
import { ingestMetaLead } from '../../lib/metaLeadIngest';

const envMock = vi.mocked(getMetaEnvConfig);
const createLeadMock = vi.mocked(createOrMergeLead);
const findByMetaIdMock = vi.mocked(findLeadByMetaLeadId);
const findUserMock = vi.mocked(findUserById);
const notifyMock = vi.mocked(notifyUsers);
const configMock = vi.mocked(getMetaIntegrationConfig);
const roundRobinMock = vi.mocked(resolveNextRoundRobinOwnerId);
const fetchDetailsMock = vi.mocked(fetchLeadDetails);

function fakeRow(initial: Record<string, unknown>) {
  const plain = { ...initial };
  return { update: vi.fn(async (attrs: Record<string, unknown>) => Object.assign(plain, attrs)), plain };
}

function leadDetails(over: Record<string, unknown> = {}) {
  return {
    leadId: '555',
    createdAt: '2026-10-01T00:00:00.000Z',
    adId: '',
    adName: '',
    adsetId: '',
    adsetName: '',
    campaignId: 'camp-1',
    campaignName: 'Diwali Promo',
    formId: 'form-1',
    formName: 'Contact Us',
    platform: 'fb' as const,
    fieldData: [{ name: 'full_name', values: ['Jane Doe'] }, { name: 'email', values: ['jane@example.com'] }],
    ...over
  };
}

function defaultConfig(over: Record<string, unknown> = {}) {
  return {
    assignmentMode: 'fixed' as const,
    campaignRoutingMap: {},
    roundRobinPool: [] as string[],
    defaultOwnerId: '',
    ...over
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  envMock.mockReturnValue({ appId: 'a', appSecret: 's', verifyToken: 'v', pageId: 'page-1', pageAccessToken: 'token-1' });
  m.create.mockImplementation(async (attrs: Record<string, unknown>) => fakeRow({ status: 'pending', ...attrs }));
  findByMetaIdMock.mockResolvedValue(undefined);
  configMock.mockResolvedValue(defaultConfig());
  createLeadMock.mockResolvedValue({ record: { id: 'lead-row-1', name: 'Jane Doe', company: '', priority: '' }, merged: false } as never);
});

describe('duplicate protection', () => {
  it('short-circuits on the pre-check without ever calling the Graph API', async () => {
    findByMetaIdMock.mockResolvedValue({ id: 'existing-lead' } as never);

    const result = await ingestMetaLead('555', { pageId: 'page-1' });

    expect(result).toEqual({ status: 'ignored_duplicate', leadId: 'existing-lead' });
    expect(fetchDetailsMock).not.toHaveBeenCalled();
    expect(createLeadMock).not.toHaveBeenCalled();
  });

  it('falls back to the DB unique-constraint race when two deliveries both pass the pre-check', async () => {
    fetchDetailsMock.mockResolvedValue(leadDetails());
    createLeadMock.mockRejectedValueOnce(Object.assign(new Error('duplicate key value violates unique constraint "leads_meta_lead_id_unique"'), { name: 'SequelizeUniqueConstraintError' }));
    findByMetaIdMock.mockResolvedValueOnce(undefined).mockResolvedValueOnce({ id: 'winner-lead' } as never);

    const result = await ingestMetaLead('555', { pageId: 'page-1' });

    expect(result).toEqual({ status: 'ignored_duplicate', leadId: 'winner-lead' });
    expect(findByMetaIdMock).toHaveBeenCalledTimes(2);
  });
});

describe('missing configuration', () => {
  it('fails fast without calling the Graph API when no Page Access Token is configured', async () => {
    envMock.mockReturnValue({ appId: 'a', appSecret: 's', verifyToken: 'v', pageId: 'page-1', pageAccessToken: '' });

    const result = await ingestMetaLead('555', { pageId: 'page-1' });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('Page Access Token');
    expect(fetchDetailsMock).not.toHaveBeenCalled();
  });
});

describe('retries', () => {
  it('retries once on a transient network error and succeeds on the second attempt', async () => {
    vi.useFakeTimers();
    fetchDetailsMock.mockRejectedValueOnce(new MetaGraphError('network', 'Could not reach the Meta Graph API — network error.', 'ECONNRESET')).mockResolvedValueOnce(leadDetails());

    const promise = ingestMetaLead('555', { pageId: 'page-1' });
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;

    expect(result.status).toBe('created');
    expect(fetchDetailsMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('does not retry a non-retryable expired-token error — fails after exactly one attempt', async () => {
    fetchDetailsMock.mockRejectedValue(
      new MetaGraphError('expired_token', 'The Meta access token is invalid or has expired. Reconnect via Meta Business Suite and update META_PAGE_ACCESS_TOKEN.', '[190] OAuthException')
    );

    const result = await ingestMetaLead('555', { pageId: 'page-1' });

    expect(result.status).toBe('failed');
    expect(fetchDetailsMock).toHaveBeenCalledTimes(1);
  });

  it('gives up after two attempts when the transient error persists', async () => {
    vi.useFakeTimers();
    fetchDetailsMock.mockRejectedValue(new MetaGraphError('rate_limit', 'Meta API rate limit reached — this will be retried automatically.', '[4] OAuthException'));

    const promise = ingestMetaLead('555', { pageId: 'page-1' });
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;

    expect(result.status).toBe('failed');
    expect(fetchDetailsMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

describe('Meta test leads', () => {
  it('ignores a Page-generated test lead instead of landing it in Sales’ queue', async () => {
    fetchDetailsMock.mockResolvedValue(leadDetails({ fieldData: [{ name: 'full_name', values: ['<test lead: dummy data for full_name>'] }] }));

    const result = await ingestMetaLead('555', { pageId: 'page-1' });

    expect(result.status).toBe('ignored_test_lead');
    expect(createLeadMock).not.toHaveBeenCalled();
  });
});

describe('lead creation and assignment', () => {
  it('creates the lead, normalizes fields, and notifies the resolved owner', async () => {
    fetchDetailsMock.mockResolvedValue(leadDetails());
    configMock.mockResolvedValue(defaultConfig({ defaultOwnerId: 'owner-1' }));
    findUserMock.mockResolvedValue({ id: 'owner-1', username: 'priya', role: 'sales' } as never);

    const result = await ingestMetaLead('555', { pageId: 'page-1' });

    expect(result.status).toBe('created');
    expect(createLeadMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Jane Doe', email: 'jane@example.com', source: 'meta_lead_ads' }),
      'priya'
    );
    expect(notifyMock).toHaveBeenCalledWith(['priya'], expect.objectContaining({ type: 'meta_lead_assigned' }));
  });

  it('routes by campaign when assignment mode is campaign-based', async () => {
    fetchDetailsMock.mockResolvedValue(leadDetails({ campaignId: 'camp-xyz' }));
    configMock.mockResolvedValue(defaultConfig({ assignmentMode: 'campaign', campaignRoutingMap: { 'camp-xyz': { ownerId: 'owner-2' } }, defaultOwnerId: 'owner-fallback' }));
    findUserMock.mockResolvedValue({ id: 'owner-2', username: 'arjun', role: 'sales' } as never);

    await ingestMetaLead('555', { pageId: 'page-1' });

    expect(findUserMock).toHaveBeenCalledWith('owner-2');
  });

  it('routes round-robin and still lands the lead unassigned if nobody resolves', async () => {
    fetchDetailsMock.mockResolvedValue(leadDetails());
    configMock.mockResolvedValue(defaultConfig({ assignmentMode: 'round_robin', roundRobinPool: ['owner-3'] }));
    roundRobinMock.mockResolvedValue(null);
    findUserMock.mockResolvedValue(undefined);

    const result = await ingestMetaLead('555', { pageId: 'page-1' });

    expect(result.status).toBe('created');
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('reports a save failure instead of losing the lead silently', async () => {
    fetchDetailsMock.mockResolvedValue(leadDetails());
    createLeadMock.mockRejectedValue(new Error('DB is down'));

    const result = await ingestMetaLead('555', { pageId: 'page-1' });

    expect(result.status).toBe('failed');
  });
});
