import { describe, it, expect } from 'vitest';
import {
  PARTNER_REVIEW_EVENT_LABEL,
  PARTNER_SUBMISSION_EVENT_LABEL,
  awaitingSide,
  buildPartnerReviewThread,
  informationRequestCount,
  latestInformationRequest,
  sideOfEvent
} from '../../lib/partnerReviewThread';

// Direction is the thing that must not be wrong. An entry attributed to the
// wrong side turns "we asked them" into "they told us", which is exactly the
// sentence an argument about a stalled submission turns on.

describe('sideOfEvent', () => {
  it('attributes every review decision to the internal side', () => {
    expect(sideOfEvent(PARTNER_REVIEW_EVENT_LABEL.approved)).toBe('internal');
    expect(sideOfEvent(PARTNER_REVIEW_EVENT_LABEL.rejected)).toBe('internal');
    expect(sideOfEvent(PARTNER_REVIEW_EVENT_LABEL.info_requested)).toBe('internal');
  });

  it('attributes the submission itself to the partner', () => {
    expect(sideOfEvent(PARTNER_SUBMISSION_EVENT_LABEL)).toBe('partner');
  });

  it('treats an unrecognised label as partner-authored rather than internal', () => {
    // Fails toward the partner on purpose: mislabelling a partner's own words
    // as ours puts words in their mouth, which is the worse of the two errors.
    expect(sideOfEvent('Something nobody has written yet')).toBe('partner');
    expect(sideOfEvent('')).toBe('partner');
  });
});

describe('buildPartnerReviewThread', () => {
  const submission = { at: '2026-10-01T09:00:00.000Z', label: PARTNER_SUBMISSION_EVENT_LABEL, remarks: 'Acme Ltd (ACME)' };
  const partnerDescription = { at: '2026-10-01T09:00:00.000Z', label: 'Update', remarks: 'Need 12 units for a hospital.' };
  const firstAsk = { at: '2026-10-02T10:00:00.000Z', label: PARTNER_REVIEW_EVENT_LABEL.info_requested, remarks: 'What is the site address?' };
  const partnerReply = { at: '2026-10-03T11:00:00.000Z', label: 'Update', remarks: 'Sector 12, Pune.' };
  const secondAsk = { at: '2026-10-04T12:00:00.000Z', label: PARTNER_REVIEW_EVENT_LABEL.info_requested, remarks: 'And the expected date?' };

  it('interleaves both tables into one conversation, oldest first', () => {
    const thread = buildPartnerReviewThread({
      timeline: [firstAsk, submission, secondAsk],
      notes: [partnerReply, partnerDescription]
    });
    expect(thread.map((e) => [e.side, e.title])).toEqual([
      ['partner', 'Submitted'],
      ['partner', 'Partner replied'],
      ['internal', 'Information requested'],
      ['partner', 'Partner replied'],
      ['internal', 'Information requested']
    ]);
  });

  it('puts a decision before a note written in the same transaction', () => {
    // Both rows carry the same timestamp. The decision is what prompted the
    // reply, so reading it second would invert cause and effect.
    const sameInstant = '2026-10-05T08:00:00.000Z';
    const thread = buildPartnerReviewThread({
      timeline: [{ at: sameInstant, label: PARTNER_REVIEW_EVENT_LABEL.info_requested, remarks: 'Ask' }],
      notes: [{ at: sameInstant, label: 'Update', remarks: 'Reply' }]
    });
    expect(thread.map((e) => e.side)).toEqual(['internal', 'partner']);
  });

  it('keeps every round rather than only the most recent', () => {
    // The whole reason this module exists: partner_review_remarks holds one
    // string and round two overwrites round one.
    const thread = buildPartnerReviewThread({ timeline: [firstAsk, secondAsk], notes: [] });
    expect(thread.map((e) => e.body)).toEqual(['What is the site address?', 'And the expected date?']);
  });

  it('marks a decision that carried no remark rather than dropping it', () => {
    const thread = buildPartnerReviewThread({
      timeline: [{ at: '2026-10-06T08:00:00.000Z', label: PARTNER_REVIEW_EVENT_LABEL.approved, remarks: '' }],
      notes: []
    });
    expect(thread).toHaveLength(1);
    expect(thread[0]).toMatchObject({ side: 'internal', title: 'Accepted', body: '' });
  });

  it('returns an empty thread for a project with no exchange', () => {
    expect(buildPartnerReviewThread({ timeline: [], notes: [] })).toEqual([]);
  });

  it('reads identically for both audiences — one thread, not two', () => {
    // The internal panel and the portal call this with the same rows. If the
    // function ever became audience-aware, the two sides could describe the
    // same exchange differently.
    const source = { timeline: [submission, firstAsk], notes: [partnerReply] };
    expect(buildPartnerReviewThread(source)).toEqual(buildPartnerReviewThread(source));
  });
});

describe('selectors over the thread', () => {
  const thread = buildPartnerReviewThread({
    timeline: [
      { at: '2026-10-02T10:00:00.000Z', label: PARTNER_REVIEW_EVENT_LABEL.info_requested, remarks: 'First ask' },
      { at: '2026-10-04T12:00:00.000Z', label: PARTNER_REVIEW_EVENT_LABEL.info_requested, remarks: 'Second ask' },
      { at: '2026-10-06T12:00:00.000Z', label: PARTNER_REVIEW_EVENT_LABEL.approved, remarks: 'Looks good' }
    ],
    notes: [{ at: '2026-10-03T11:00:00.000Z', label: 'Update', remarks: 'Answered' }]
  });

  it('reports the most recent ask, not the first', () => {
    expect(latestInformationRequest(thread)).toBe('Second ask');
  });

  it('still reports the ask after an approval has overwritten the remarks column', () => {
    // The approval remark is the last internal entry; the selector must skip
    // past it rather than return 'Looks good'.
    expect(latestInformationRequest(thread)).not.toBe('Looks good');
  });

  it('counts the rounds so a reviewer knows this is not the first', () => {
    expect(informationRequestCount(thread)).toBe(2);
    expect(informationRequestCount([])).toBe(0);
  });

  it('returns no ask when none was ever made', () => {
    expect(latestInformationRequest(buildPartnerReviewThread({ timeline: [], notes: [] }))).toBe('');
  });
});

describe('awaitingSide', () => {
  it('puts the ball in the partner court while information is outstanding', () => {
    expect(awaitingSide('info_requested')).toBe('partner');
  });

  it('puts it in ours while a submission waits on a decision', () => {
    expect(awaitingSide('submitted')).toBe('internal');
  });

  it('says nobody owes a reply once the submission is settled', () => {
    expect(awaitingSide('approved')).toBeNull();
    expect(awaitingSide('rejected')).toBeNull();
    expect(awaitingSide('')).toBeNull();
  });
});
