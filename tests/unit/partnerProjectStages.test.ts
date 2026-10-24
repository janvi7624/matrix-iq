import { describe, it, expect } from 'vitest';
import {
  canReviewTransition,
  partnerStageProgressPercent,
  partnerActionRequired,
  resolvePartnerStage,
  PARTNER_STAGE_STEPS,
  PARTNER_STAGE_LABEL,
  PartnerSubmissionStatus
} from '../../lib/partnerProjectStages';

function input(over: Partial<Parameters<typeof resolvePartnerStage>[0]> = {}) {
  return {
    partner_submission_status: 'approved',
    stage: 'cold_call',
    status: 'active',
    sales_person: 'rep',
    hasSharedQuotation: false,
    hasDemo: false,
    ...over
  };
}

describe('resolvePartnerStage — the submission gate comes first', () => {
  // The sharpest case in this file. A new project's stage defaults to
  // 'cold_call' in the DB, so without the gate an unreviewed submission
  // would tell the partner work had started when nobody had looked at it.
  it('reports awaiting review while unreviewed, whatever the pipeline says', () => {
    expect(resolvePartnerStage(input({ partner_submission_status: 'submitted', stage: 'negotiation' }))).toBe('awaiting_review');
  });

  it('reports the exception states ahead of any pipeline progress', () => {
    expect(resolvePartnerStage(input({ partner_submission_status: 'rejected', stage: 'quotation' }))).toBe('rejected');
    expect(resolvePartnerStage(input({ partner_submission_status: 'info_requested', stage: 'demo' }))).toBe('info_requested');
  });

  it('falls back to awaiting review for a project with no submission status', () => {
    // Not a partner submission at all. Callers should not ask, but the answer
    // must not claim progress that may not have happened.
    expect(resolvePartnerStage(input({ partner_submission_status: '' }))).toBe('awaiting_review');
  });
});

describe('resolvePartnerStage — terminal status outranks stage', () => {
  it.each([
    ['won', 'won'],
    ['lost', 'lost'],
    ['on_hold', 'on_hold']
  ])('maps status %s to %s regardless of stage', (status, expected) => {
    expect(resolvePartnerStage(input({ status, stage: 'demo' }))).toBe(expected);
  });

  it('treats closed_lost as lost', () => {
    expect(resolvePartnerStage(input({ stage: 'closed_lost' }))).toBe('lost');
  });
});

describe('resolvePartnerStage — pipeline derivation', () => {
  // Mirrors the LIVE internal pipeline (lib/projectStages.ts):
  // prospect -> demo -> quotation -> negotiation -> commit.
  it.each([
    ['prospect', 'prospect'],
    ['demo', 'demo'],
    ['quotation', 'quotation_shared'],
    ['negotiation', 'negotiation'],
    ['commit', 'commit']
  ])('maps internal stage %s to partner stage %s', (stage, expected) => {
    expect(resolvePartnerStage(input({ stage }))).toBe(expected);
  });

  it('maps the retired stage spellings old rows still carry', () => {
    // The enum keeps them and 'cold_call' is still settable — a project
    // written before the rename must not fall through to a default.
    expect(resolvePartnerStage(input({ stage: 'cold_call' }))).toBe('prospect');
    expect(resolvePartnerStage(input({ stage: 'catalogue_offered' }))).toBe('prospect');
    expect(resolvePartnerStage(input({ stage: 'site_visit' }))).toBe('prospect');
    expect(resolvePartnerStage(input({ stage: 'customer_response' }))).toBe('quotation_shared');
    for (const stage of ['po_received', 'installation', 'completed']) {
      expect(resolvePartnerStage(input({ stage }))).toBe('commit');
    }
  });

  it('prefers a shared quotation over an un-advanced stage field', () => {
    // A sales person may not have moved the stage yet; an actually-shared
    // quotation is harder evidence.
    expect(resolvePartnerStage(input({ stage: 'prospect', hasSharedQuotation: true }))).toBe('quotation_shared');
  });

  it('prefers a booked demo over early-stage work', () => {
    expect(resolvePartnerStage(input({ stage: 'prospect', hasDemo: true }))).toBe('demo');
  });

  it('does not let evidence drag a later stage backwards', () => {
    // At negotiation, an older demo must not pull the reading back to 'demo'.
    expect(resolvePartnerStage(input({ stage: 'negotiation', hasDemo: true, hasSharedQuotation: true }))).toBe('negotiation');
  });

  it('falls back to prospect for an unrecognised stage', () => {
    expect(resolvePartnerStage(input({ stage: 'some_future_stage' }))).toBe('prospect');
  });
});

describe('progress and action flags', () => {
  it('gives every step a label', () => {
    for (const step of PARTNER_STAGE_STEPS) {
      expect(PARTNER_STAGE_LABEL[step]).toBeTruthy();
    }
  });

  it('reports 100% only for won, and 0% for the bad endings', () => {
    expect(partnerStageProgressPercent('won')).toBe(100);
    expect(partnerStageProgressPercent('lost')).toBe(0);
    expect(partnerStageProgressPercent('rejected')).toBe(0);
  });

  it('keeps the partner stepper aligned with the internal pipeline', () => {
    // The point of the rename: a partner and a salesperson looking at the
    // same deal should read the same words.
    expect(PARTNER_STAGE_STEPS.slice(2)).toEqual(['prospect', 'demo', 'quotation_shared', 'negotiation', 'commit']);
    expect(PARTNER_STAGE_LABEL.demo).toBe('Demo / Qualified');
  });

  it('increases monotonically across the stepper', () => {
    const percents = PARTNER_STAGE_STEPS.map(partnerStageProgressPercent);
    for (let i = 1; i < percents.length; i++) {
      expect(percents[i]).toBeGreaterThan(percents[i - 1]);
    }
  });

  it('asks the partner to act only when information is requested', () => {
    expect(partnerActionRequired('info_requested')).toBe(true);
    for (const stage of PARTNER_STAGE_STEPS) {
      expect(partnerActionRequired(stage)).toBe(false);
    }
  });
});

describe('canReviewTransition', () => {
  it('lets a fresh submission go any of the three ways', () => {
    for (const to of ['approved', 'rejected', 'info_requested'] as PartnerSubmissionStatus[]) {
      expect(canReviewTransition('submitted', to)).toBe(true);
    }
  });

  it('never un-accepts an approved submission', () => {
    // Work starts the moment it is accepted — quotations, demos, assignment.
    // Retracting acceptance would strand all of it.
    for (const to of ['rejected', 'info_requested', 'submitted'] as PartnerSubmissionStatus[]) {
      expect(canReviewTransition('approved', to)).toBe(false);
    }
  });

  it('allows a declined submission to be reconsidered', () => {
    expect(canReviewTransition('rejected', 'approved')).toBe(true);
  });

  it('refuses a decision on a project that is not a partner submission', () => {
    expect(canReviewTransition('', 'approved')).toBe(false);
  });
});
