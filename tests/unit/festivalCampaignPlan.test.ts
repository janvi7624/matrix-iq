import { describe, it, expect } from 'vitest';
import {
  addDays,
  buildRecipients,
  campaignDayAction,
  creativeDueDate,
  istDateOnly,
  istHour,
  isValidEmail,
  pickBannerPath,
  readPositiveInt,
  shouldRaiseRequest,
  splitEmails
} from '../../lib/festivalCampaignPlan';

describe('IST date helpers', () => {
  it('rolls over to the next IST day at 18:30 UTC', () => {
    expect(istDateOnly(new Date('2026-11-12T18:29:00Z'))).toBe('2026-11-12');
    expect(istDateOnly(new Date('2026-11-12T18:30:00Z'))).toBe('2026-11-13');
  });
  it('reports the IST hour', () => {
    expect(istHour(new Date('2026-11-13T03:30:00Z'))).toBe(9);
  });
  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-12-25', 10)).toBe('2027-01-04');
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28');
  });
});

describe('shouldRaiseRequest', () => {
  it('raises inside the lead window but not on or after the festival', () => {
    expect(shouldRaiseRequest('2026-12-25', '2026-12-14', 10)).toBe(false);
    expect(shouldRaiseRequest('2026-12-25', '2026-12-15', 10)).toBe(true);
    expect(shouldRaiseRequest('2026-12-25', '2026-12-24', 10)).toBe(true);
    expect(shouldRaiseRequest('2026-12-25', '2026-12-25', 10)).toBe(false);
  });
});

describe('creativeDueDate', () => {
  it('is three days before the festival, never in the past', () => {
    expect(creativeDueDate('2026-12-25', '2026-12-15')).toBe('2026-12-22');
    expect(creativeDueDate('2026-12-25', '2026-12-24')).toBe('2026-12-24');
  });
});

describe('campaignDayAction', () => {
  const day = '2026-12-25';
  it('waits before the festival and before the send hour', () => {
    expect(campaignDayAction('approved', day, '2026-12-24', 23, 9)).toBe('wait');
    expect(campaignDayAction('approved', day, day, 8, 9)).toBe('wait');
  });
  it('sends an approved campaign at the send hour', () => {
    expect(campaignDayAction('approved', day, day, 9, 9)).toBe('send');
  });
  it('skips anything unapproved on the day — nothing reaches a client unreviewed', () => {
    expect(campaignDayAction('pending_approval', day, day, 9, 9)).toBe('skip');
    expect(campaignDayAction('awaiting_creative', day, day, 12, 9)).toBe('skip');
  });
  it('never sends a greeting after the festival has passed', () => {
    expect(campaignDayAction('approved', day, '2026-12-26', 9, 9)).toBe('skip');
  });
  it('leaves finished or in-flight campaigns alone', () => {
    expect(campaignDayAction('sent', day, day, 10, 9)).toBe('wait');
    expect(campaignDayAction('skipped', day, day, 10, 9)).toBe('wait');
    expect(campaignDayAction('sending', day, day, 10, 9)).toBe('wait');
  });
});

describe('email parsing', () => {
  it('validates conservatively', () => {
    expect(isValidEmail('a.b@example.co.in')).toBe(true);
    expect(isValidEmail('no-at-sign.com')).toBe(false);
    expect(isValidEmail('x@nodot')).toBe(false);
    expect(isValidEmail('')).toBe(false);
  });
  it('splits several addresses in one field', () => {
    expect(splitEmails('a@x.com, b@y.com; c@z.com')).toEqual(['a@x.com', 'b@y.com', 'c@z.com']);
  });
});

describe('buildRecipients', () => {
  it('dedupes case-insensitively, drops invalid and unsubscribed, and keeps the first name seen', () => {
    const plan = buildRecipients(
      [
        { email: 'Ravi@Acme.com', name: '', company: 'Acme' },
        { email: 'ravi@acme.com', name: 'Ravi Shah', company: '' },
        { email: 'bad-address', name: 'X', company: '' },
        { email: 'gone@foo.com', name: 'Gone', company: '' },
        { email: '', name: 'Phone only', company: '' },
        { email: 'a@one.com, b@two.com', name: 'Two', company: 'Dual' }
      ],
      new Set(['gone@foo.com'])
    );
    expect(plan.recipients.map((r) => r.email).sort()).toEqual(['a@one.com', 'b@two.com', 'ravi@acme.com']);
    expect(plan.recipients.find((r) => r.email === 'ravi@acme.com')).toEqual({ email: 'ravi@acme.com', name: 'Ravi Shah', company: 'Acme' });
    expect(plan.invalid).toBe(1);
    expect(plan.duplicates).toBe(1);
    expect(plan.unsubscribed).toBe(1);
  });
});

describe('pickBannerPath', () => {
  it('returns the first uploaded image as a storage path', () => {
    expect(
      pickBannerPath(['https://drive.google.com/x', '/api/uploads/file/uploads/marketing/u/brief.pdf', '/api/uploads/file/uploads/marketing/u/Diwali%20Banner.png'])
    ).toBe('uploads/marketing/u/Diwali Banner.png');
  });
  it('ignores external links, non-images and traversal attempts', () => {
    expect(pickBannerPath(['https://x.com/a.png', '/api/uploads/file/a/..%2F..%2Fsecret.png', '/api/uploads/file/a/doc.pdf'])).toBeNull();
  });
});

describe('readPositiveInt', () => {
  it('falls back on garbage and out-of-range values', () => {
    expect(readPositiveInt('7', 10, 60)).toBe(7);
    expect(readPositiveInt('abc', 10, 60)).toBe(10);
    expect(readPositiveInt('99', 10, 60)).toBe(10);
    expect(readPositiveInt(undefined, 9, 23)).toBe(9);
  });
});
