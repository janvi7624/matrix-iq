import { describe, it, expect } from 'vitest';
import {
  MARKETING_STAGE_LABEL,
  MARKETING_STATUS_LABEL,
  MARKETING_INTERNAL_STATUS_LABEL,
  marketingStageOf,
  type MarketingStage
} from '../../lib/marketingRequestHelpers';
import { resolvePartnerMarketingStage } from '../../lib/partnerMarketingVisibility';
import type { MarketingRequestStatus } from '../../lib/types';

// Fourteen stored statuses collapsed onto six stages. Eleven of the fourteen
// had never been used once in four months, and the badge was naming our
// internal handoffs ("Pending Technical Review", "Timeline Set") instead of
// answering the only question a requester has: where is it, and is anyone
// waiting on me?

const ALL_STATUSES = Object.keys(MARKETING_INTERNAL_STATUS_LABEL) as MarketingRequestStatus[];

describe('every stored status maps to a stage', () => {
  it('covers all fourteen with no gaps', () => {
    expect(ALL_STATUSES).toHaveLength(14);
    for (const status of ALL_STATUSES) {
      const stage = marketingStageOf(status);
      expect(MARKETING_STAGE_LABEL[stage]).toBeTruthy();
    }
  });

  it('has a label for every status, so a badge never prints a raw key', () => {
    for (const status of ALL_STATUSES) {
      expect(MARKETING_STATUS_LABEL[status]).toBeTruthy();
      expect(MARKETING_STATUS_LABEL[status]).not.toContain('_');
    }
  });
});

describe('the buckets', () => {
  const expectStage = (statuses: string[], stage: MarketingStage) => {
    for (const s of statuses) expect(marketingStageOf(s)).toBe(stage);
  };

  it('groups the three "with us, not started" statuses as Submitted', () => {
    expectStage(['submitted', 'approved', 'timeline_set'], 'submitted');
  });

  it('groups active work as In Progress', () => {
    expectStage(['marketing_in_progress', 'in_progress'], 'in_progress');
  });

  it('puts technical change requests with Marketing, not the requester', () => {
    // Technical asked MARKETING for changes. Showing "Needs Your Input" to
    // the person who raised the request would send them chasing a thing they
    // cannot act on.
    expect(marketingStageOf('tech_changes_requested')).toBe('in_progress');
  });

  it('keeps "waiting on the requester" as its own stage', () => {
    // The single most actionable thing a status can say.
    expect(marketingStageOf('waiting_info')).toBe('needs_you');
    expect(MARKETING_STATUS_LABEL.waiting_info).toBe('Needs Your Input');
  });

  it('groups all four review handoffs as In Review', () => {
    expectStage(
      ['pending_technical_review', 'technical_approved', 'marketing_final_review', 'ready_for_review'],
      'in_review'
    );
  });

  it('closes both terminal-negative statuses, but labels them apart', () => {
    expectStage(['rejected', 'cancelled'], 'closed');
    // "We declined this" and "you withdrew it" are not the same event.
    expect(MARKETING_STATUS_LABEL.rejected).toBe('Declined');
    expect(MARKETING_STATUS_LABEL.cancelled).toBe('Cancelled');
  });
});

describe('an unknown status', () => {
  it('reads as with-us, never as finished or declined', () => {
    // A status added later must not silently tell someone their request is
    // done, or that it was refused.
    expect(marketingStageOf('some_future_status')).toBe('in_progress');
    expect(marketingStageOf('')).toBe('in_progress');
  });
});

describe('one vocabulary across the product', () => {
  it('never disagrees with the partner view about a finished request', () => {
    // The two mappings are separate functions; what must not drift is them
    // telling an internal user and a partner different things about the
    // same request.
    for (const status of ALL_STATUSES) {
      const internal = marketingStageOf(status);
      const partner = resolvePartnerMarketingStage(status);
      expect(internal === 'completed').toBe(partner === 'completed');
      expect(internal === 'closed').toBe(partner === 'rejected');
    }
  });
});

describe('Marketing keeps the precise vocabulary', () => {
  it('still names the exact handoff for the people doing the work', () => {
    expect(MARKETING_INTERNAL_STATUS_LABEL.pending_technical_review).toBe('Pending Technical Review');
    expect(MARKETING_INTERNAL_STATUS_LABEL.marketing_final_review).toBe('Marketing Final Review');
    // ...which the simplified badge deliberately does not say.
    expect(MARKETING_STATUS_LABEL.pending_technical_review).toBe('In Review');
  });
});
