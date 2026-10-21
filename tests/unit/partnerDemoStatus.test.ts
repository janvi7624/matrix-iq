import { describe, it, expect } from 'vitest';
import {
  PARTNER_DEMO_STATUS_LABEL,
  isPartnerDemoClosed,
  partnerCanCancelDemo,
  resolvePartnerDemoStatus
} from '../../lib/partnerDemoStatus';

// The internal demo_schedule enum describes OUR logistics — technical
// approval, back-office delivery challans, material dispatch and return.
// These tests pin down that none of that leaks out as partner-facing
// progress, and that the partner is never told something is further along
// than it is.

const INTERNAL_STATUSES = [
  'draft',
  'pending_technical',
  'pending_manager',
  'pending_backoffice',
  'ready_for_demo',
  'dc_generated',
  'material_dispatched',
  'demo_completed',
  'material_returned',
  'dc_closed',
  'cancelled'
];

describe('resolvePartnerDemoStatus', () => {
  it('reports a fresh request as requested', () => {
    expect(resolvePartnerDemoStatus({ status: 'draft', scheduled_at: '' })).toBe('requested');
  });

  it('collapses both internal approval steps into under review', () => {
    expect(resolvePartnerDemoStatus({ status: 'pending_technical', scheduled_at: '' })).toBe('under_review');
    expect(resolvePartnerDemoStatus({ status: 'pending_manager', scheduled_at: '' })).toBe('under_review');
  });

  it('never exposes warehouse logistics as a partner status', () => {
    // 'pending_backoffice' and 'dc_generated' are our delivery-challan
    // paperwork. To the partner they all mean one thing: agreed, we are
    // preparing. Showing the raw value would be meaningless at best and
    // alarming at worst.
    for (const status of ['pending_backoffice', 'ready_for_demo', 'dc_generated', 'material_dispatched']) {
      expect(resolvePartnerDemoStatus({ status, scheduled_at: '' })).toBe('approved');
    }
  });

  it('treats every post-demo internal state as completed', () => {
    for (const status of ['demo_completed', 'material_returned', 'dc_closed']) {
      expect(resolvePartnerDemoStatus({ status, scheduled_at: '2026-11-01T10:00:00.000Z' })).toBe('completed');
    }
  });

  it('reports scheduled only once a date actually exists', () => {
    // No internal status means "a date is agreed" — scheduled_at is the only
    // honest source, so without one we must not claim a demo is scheduled.
    expect(resolvePartnerDemoStatus({ status: 'ready_for_demo', scheduled_at: '' })).toBe('approved');
    expect(resolvePartnerDemoStatus({ status: 'ready_for_demo', scheduled_at: '2026-11-01T10:00:00.000Z' })).toBe('scheduled');
  });

  it('does not let a stale date resurrect a completed or cancelled demo', () => {
    expect(resolvePartnerDemoStatus({ status: 'dc_closed', scheduled_at: '2026-11-01T10:00:00.000Z' })).toBe('completed');
    expect(resolvePartnerDemoStatus({ status: 'cancelled', scheduled_at: '2026-11-01T10:00:00.000Z' })).toBe('cancelled');
  });

  it('falls back to under review for an unmapped internal status', () => {
    // A value added to the enum later that nobody mapped. Vague is fine;
    // claiming 'completed' or 'approved' for an unknown state is not.
    const resolved = resolvePartnerDemoStatus({ status: 'some_future_status', scheduled_at: '' });
    expect(resolved).toBe('under_review');
    expect(resolved).not.toBe('completed');
    expect(resolved).not.toBe('approved');
  });

  it('maps every real internal status to a labelled partner status', () => {
    for (const status of INTERNAL_STATUSES) {
      const resolved = resolvePartnerDemoStatus({ status, scheduled_at: '' });
      expect(PARTNER_DEMO_STATUS_LABEL[resolved]).toBeTruthy();
    }
  });
});

describe('partnerCanCancelDemo', () => {
  it('allows withdrawal before anything is committed', () => {
    for (const status of ['draft', 'pending_technical', 'pending_manager']) {
      expect(partnerCanCancelDemo(status)).toBe(true);
    }
  });

  it('refuses once materials are being prepared or have moved', () => {
    // Past this point a delivery challan exists and stock is allocated —
    // cancelling is a conversation, not a button.
    for (const status of ['pending_backoffice', 'ready_for_demo', 'dc_generated', 'material_dispatched', 'demo_completed', 'dc_closed']) {
      expect(partnerCanCancelDemo(status)).toBe(false);
    }
  });
});

describe('isPartnerDemoClosed', () => {
  it('treats completed and cancelled as terminal', () => {
    expect(isPartnerDemoClosed('completed')).toBe(true);
    expect(isPartnerDemoClosed('cancelled')).toBe(true);
    expect(isPartnerDemoClosed('scheduled')).toBe(false);
    expect(isPartnerDemoClosed('requested')).toBe(false);
  });
});
