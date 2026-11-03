import { describe, it, expect, vi, beforeEach } from 'vitest';

// Who gets the Partner module, and whose partners they see in it.
//
// These are access rules, so they get the same treatment as the proxy gate:
// the point is not that the happy path works but that the limits hold. The
// module is granted by INVOLVEMENT rather than by role, because the sales
// staff who bring partners in share the generic 'user' role with a dozen
// other accounts.

const state = vi.hoisted(() => ({ creatorIds: [] as string[], ownedCount: 0 }));

vi.mock('../../lib/appConfigStore', () => ({
  getAppConfig: vi.fn(async () => ({ partnerCreatorIds: state.creatorIds }))
}));

vi.mock('../../lib/db', () => ({
  db: { Partner: { count: vi.fn(async () => state.ownedCount) } },
  sequelize: {},
  isUuid: () => true
}));

import {
  canSeePartnerWorkspace,
  isPartnerWorkspaceModule,
  partnerWorkspaceScope,
  resolvePartnerStakeholder,
  PARTNER_WORKSPACE_MODULE_KEY
} from '../../lib/partnerWorkspaceAccess';

beforeEach(() => {
  vi.clearAllMocks();
  state.creatorIds = [];
  state.ownedCount = 0;
});

describe('isPartnerWorkspaceModule', () => {
  it('matches only its own key', () => {
    expect(isPartnerWorkspaceModule(PARTNER_WORKSPACE_MODULE_KEY)).toBe(true);
    // 'partners' is the separate org-wide administrative tile — granting the
    // involvement rule to it would open /admin/partners to every creator.
    expect(isPartnerWorkspaceModule('partners')).toBe(false);
    expect(isPartnerWorkspaceModule('partner-analytics')).toBe(false);
    expect(isPartnerWorkspaceModule('')).toBe(false);
  });
});

describe('canSeePartnerWorkspace', () => {
  it('admits the admin tier', () => {
    expect(canSeePartnerWorkspace({ isPrivileged: true })).toBe(true);
  });

  it('admits anyone involved with a partner', () => {
    expect(canSeePartnerWorkspace({ isPartnerStakeholder: true })).toBe(true);
  });

  // Fails closed: neither flag means no tile and no API.
  it('refuses everyone else', () => {
    expect(canSeePartnerWorkspace({})).toBe(false);
    expect(canSeePartnerWorkspace({ isPrivileged: false, isPartnerStakeholder: false })).toBe(false);
  });
});

describe('resolvePartnerStakeholder', () => {
  it('is true for somebody on the creator list, before they own anything', () => {
    state.creatorIds = ['emp-1'];
    state.ownedCount = 0;
    return expect(resolvePartnerStakeholder('emp-1')).resolves.toBe(true);
  });

  it('is true for the relationship manager or creator of a partner', async () => {
    state.ownedCount = 2;
    expect(await resolvePartnerStakeholder('emp-1')).toBe(true);
  });

  // Somebody taken off the creator list keeps the module for the partners
  // they already own, rather than those partners becoming unreachable.
  it('is true from ownership alone, with an empty creator list', async () => {
    state.creatorIds = [];
    state.ownedCount = 1;
    expect(await resolvePartnerStakeholder('emp-1')).toBe(true);
  });

  it('is false for somebody with neither', async () => {
    expect(await resolvePartnerStakeholder('emp-1')).toBe(false);
  });

  it('is false for a missing user id without querying', async () => {
    const { db } = await import('../../lib/db');
    expect(await resolvePartnerStakeholder('')).toBe(false);
    expect(db.Partner.count).not.toHaveBeenCalled();
  });

  // The cheap check first: being named on the list needs no partner query.
  it('does not query when the creator list already answers it', async () => {
    state.creatorIds = ['emp-1'];
    const { db } = await import('../../lib/db');
    await resolvePartnerStakeholder('emp-1');
    expect(db.Partner.count).not.toHaveBeenCalled();
  });
});

describe('partnerWorkspaceScope', () => {
  // null means "no filter" — the whole list.
  it('gives the full list to someone who sees all partners', () => {
    expect(partnerWorkspaceScope({ userId: 'emp-1', seesAllPartners: true })).toBeNull();
  });

  // The "no mix-ups" rule: your own book, not the company's.
  it('scopes everyone else to themselves', () => {
    expect(partnerWorkspaceScope({ userId: 'emp-1', seesAllPartners: false })).toEqual({ ownerIds: ['emp-1'] });
  });
});
