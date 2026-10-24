import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// Layer 2 of the Partner Portal's isolation (proxy.ts is layer 1, the
// mandatory partner_id in every partner query is layer 3): getViewerContext
// refuses partner accounts unless a caller explicitly opts in, which is what
// hardens every existing internal API at once instead of relying on ~35
// route files each remembering a check.

vi.mock('../../lib/auth', () => ({ getSessionFromRequest: vi.fn() }));
vi.mock('../../lib/permissions', () => ({ resolveIsPrivileged: vi.fn(async () => false) }));
vi.mock('../../lib/userStore', () => ({ findUserStatusById: vi.fn() }));
vi.mock('../../lib/partnerStore', () => ({ findPartnerById: vi.fn(), isPartnerUsable: (s: string) => s === 'active' }));

import { getSessionFromRequest } from '../../lib/auth';
import { findUserStatusById } from '../../lib/userStore';
import { findPartnerById } from '../../lib/partnerStore';
import { getViewerContext } from '../../lib/viewerContext';
import { getPartnerViewer, partnerOwns } from '../../lib/partnerContext';

const sessionMock = vi.mocked(getSessionFromRequest);
const userMock = vi.mocked(findUserStatusById);
const partnerMock = vi.mocked(findPartnerById);

const REQ = {} as NextRequest;

function signedInAs(opts: { partnerId?: string; status?: string }) {
  sessionMock.mockResolvedValue({
    sub: 'user-1',
    username: 'acme.ravi',
    role: opts.partnerId ? 'partner-admin' : 'user',
    exp: Date.now() + 60_000,
    isPrivileged: false,
    partnerId: opts.partnerId
  });
  userMock.mockResolvedValue({
    id: 'user-1',
    status: opts.status ?? 'active',
    name: 'Ravi',
    partnerId: opts.partnerId ?? ''
  });
}

function partnerCompany(over: Record<string, unknown> = {}) {
  partnerMock.mockResolvedValue({
    id: 'partner-1',
    partner_code: 'PTR-0001',
    company_name: 'Acme Systems',
    contact_person: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    state: '',
    country: '',
    gst_number: '',
    status: 'active',
    departments: [],
    product_categories: [],
    territory: [],
    relationship_manager_id: 'rm-1',
    relationship_manager_name: 'Priya',
    notes: '',
    created_at: '',
    updated_at: '',
    ...over
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getViewerContext — deny-by-default for partner accounts', () => {
  it('refuses a partner account by default', async () => {
    signedInAs({ partnerId: 'partner-1' });
    expect(await getViewerContext(REQ)).toBeNull();
  });

  it('resolves a partner only when a caller explicitly opts in', async () => {
    signedInAs({ partnerId: 'partner-1' });
    const viewer = await getViewerContext(REQ, { allowPartner: true });
    expect(viewer?.partnerId).toBe('partner-1');
  });

  it('still resolves internal staff normally, with an empty partnerId', async () => {
    signedInAs({});
    const viewer = await getViewerContext(REQ);
    expect(viewer?.username).toBe('acme.ravi');
    expect(viewer?.partnerId).toBe('');
  });

  it('keeps refusing a deactivated account regardless of the opt-in', async () => {
    signedInAs({ partnerId: 'partner-1', status: 'inactive' });
    expect(await getViewerContext(REQ, { allowPartner: true })).toBeNull();
  });

  // The session token's partnerId claim cannot change until the next login,
  // so the binding that governs authorization is read from the users row.
  it('trusts the live user row over the token claim', async () => {
    sessionMock.mockResolvedValue({
      sub: 'user-1',
      username: 'acme.ravi',
      role: 'partner-admin',
      exp: Date.now() + 60_000,
      isPrivileged: false
      // no partnerId claim — e.g. a token issued before the binding existed
    });
    userMock.mockResolvedValue({ id: 'user-1', status: 'active', name: 'Ravi', partnerId: 'partner-1' });
    expect(await getViewerContext(REQ)).toBeNull();
  });
});

describe('getPartnerViewer — the mirror-image refusal', () => {
  it('resolves an active partner', async () => {
    signedInAs({ partnerId: 'partner-1' });
    partnerCompany();
    const viewer = await getPartnerViewer(REQ);
    expect(viewer?.partner.company_name).toBe('Acme Systems');
  });

  it('refuses internal staff — there is no act-as-partner mode', async () => {
    signedInAs({});
    expect(await getPartnerViewer(REQ)).toBeNull();
  });

  it.each(['suspended', 'pending', 'inactive'])('refuses a partner whose company is %s', async (status) => {
    signedInAs({ partnerId: 'partner-1' });
    partnerCompany({ status });
    // This is what makes suspension immediate: proxy.ts gates on a token
    // claim that survives until the next login, so without this check a
    // suspended partner would keep working for the life of their session.
    expect(await getPartnerViewer(REQ)).toBeNull();
  });

  it('fails closed when the binding points at a partner that no longer resolves', async () => {
    signedInAs({ partnerId: 'partner-1' });
    partnerMock.mockResolvedValue(undefined);
    expect(await getPartnerViewer(REQ)).toBeNull();
  });
});

describe('partnerOwns', () => {
  const viewer = { partnerId: 'partner-1' } as never as Parameters<typeof partnerOwns>[0];

  it('accepts a record belonging to the viewer’s partner', () => {
    expect(partnerOwns(viewer, { partner_id: 'partner-1' })).toBe(true);
  });

  it('rejects another partner’s record', () => {
    expect(partnerOwns(viewer, { partner_id: 'partner-2' })).toBe(false);
  });

  it('rejects an internal record that carries no partner at all', () => {
    // Otherwise an internal-only record would be reachable through a partner
    // route by guessing its id.
    expect(partnerOwns(viewer, { partner_id: null })).toBe(false);
    expect(partnerOwns(viewer, {})).toBe(false);
    expect(partnerOwns(viewer, null)).toBe(false);
  });
});
