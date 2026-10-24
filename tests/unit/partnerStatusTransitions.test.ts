import { describe, it, expect, vi } from 'vitest';
import type { PartnerStatus } from '../../lib/types';

vi.mock('../../lib/db', () => ({ db: {}, isUuid: () => true }));

import { canTransitionPartnerStatus, isPartnerUsable } from '../../lib/partnerStore';

const ALL: PartnerStatus[] = ['pending', 'active', 'suspended', 'inactive'];

describe('isPartnerUsable', () => {
  it('admits only active partners', () => {
    expect(isPartnerUsable('active')).toBe(true);
    for (const status of ['pending', 'suspended', 'inactive']) {
      expect(isPartnerUsable(status)).toBe(false);
    }
  });

  it('fails closed on an unrecognised status', () => {
    // A status this code has never heard of must not be treated as usable —
    // the default has to be "no access", not "assume fine".
    expect(isPartnerUsable('')).toBe(false);
    expect(isPartnerUsable('ACTIVE')).toBe(false);
    expect(isPartnerUsable('whatever')).toBe(false);
  });
});

describe('canTransitionPartnerStatus', () => {
  it('lets a pending partner go live or be abandoned', () => {
    expect(canTransitionPartnerStatus('pending', 'active')).toBe(true);
    expect(canTransitionPartnerStatus('pending', 'inactive')).toBe(true);
  });

  it('never returns a partner to pending once it exists', () => {
    // 'pending' means "no login issued yet". Once one exists that is no
    // longer true, and pretending otherwise would hide a live account behind
    // a not-set-up-yet label.
    for (const from of ['active', 'suspended', 'inactive'] as PartnerStatus[]) {
      expect(canTransitionPartnerStatus(from, 'pending')).toBe(false);
    }
  });

  it('makes suspension reversible in both directions', () => {
    // Suspension is routinely temporary (a payment dispute, a compliance
    // review) and must never be a one-way door.
    expect(canTransitionPartnerStatus('active', 'suspended')).toBe(true);
    expect(canTransitionPartnerStatus('suspended', 'active')).toBe(true);
  });

  it('allows an ended relationship to be resumed', () => {
    expect(canTransitionPartnerStatus('inactive', 'active')).toBe(true);
  });

  it('refuses suspending a partner that was never set up or already ended', () => {
    expect(canTransitionPartnerStatus('pending', 'suspended')).toBe(false);
    expect(canTransitionPartnerStatus('inactive', 'suspended')).toBe(false);
  });

  it('treats every status as a non-transition to itself', () => {
    // setPartnerStatus short-circuits from === to, so these never reach the
    // table; asserting it keeps a future refactor from silently making
    // "activate an already-active partner" throw.
    for (const s of ALL) {
      expect(canTransitionPartnerStatus(s, s)).toBe(false);
    }
  });
});
