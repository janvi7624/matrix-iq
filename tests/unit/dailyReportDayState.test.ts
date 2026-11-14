import { describe, it, expect } from 'vitest';
import { dailyReportDayState } from '../../lib/dailyReportDayState';

// The day strip's five colours and, more importantly, which one wins when a
// day is in more than one state at once. A warning is a record against the
// person that stands until somebody waives it, so it is never the state that
// gets dropped — otherwise the only way to find which days carry one would be
// to hover every day in the month.

const WARN = { warning_status: 'ACTIVE' };

describe('the plain states', () => {
  it('filed on time', () => {
    expect(dailyReportDayState({ submission_status: 'SUBMITTED' })).toEqual({ state: 'on-time', label: 'Filed' });
  });

  it('filed late', () => {
    expect(dailyReportDayState({ submission_status: 'SUBMITTED_LATE' })).toEqual({ state: 'late', label: 'Late' });
  });

  it('approved leave', () => {
    expect(dailyReportDayState({ submission_status: 'MISSING', leave_status: 'APPROVED' })).toEqual({ state: 'leave', label: 'On leave' });
  });

  it('missed, with no warning recorded yet', () => {
    expect(dailyReportDayState({ submission_status: 'MISSING' })).toEqual({ state: 'missing', label: 'Missing' });
  });

  it('today, not filed but not yet due', () => {
    // The deadline is 11:30 the NEXT morning, so this must not read as late.
    expect(dailyReportDayState({ submission_status: 'PENDING' }).state).toBe('pending');
  });

  it('a draft is not a filing', () => {
    expect(dailyReportDayState({ submission_status: 'DRAFT' }).state).toBe('draft');
  });
});

describe('a warning outranks every other state', () => {
  it('beats a missed day', () => {
    expect(dailyReportDayState({ submission_status: 'MISSING', ...WARN })).toEqual({
      state: 'warned',
      label: 'Not filed — warning recorded'
    });
  });

  it('beats a late filing', () => {
    expect(dailyReportDayState({ submission_status: 'SUBMITTED_LATE', ...WARN })).toEqual({
      state: 'warned',
      label: 'Filed late — warning recorded'
    });
  });

  it('beats a day that was filed ON TIME, and says so', () => {
    // Real case: the sweep warned 2026-11-05 and the report landed after.
    // Both facts are true — the colour flags it, the label explains it, so
    // it cannot read as "you missed this day".
    expect(dailyReportDayState({ submission_status: 'SUBMITTED', ...WARN })).toEqual({
      state: 'warned',
      label: 'Filed — warning recorded'
    });
  });

  it('beats approved leave, which should never co-occur', () => {
    // Approving leave waives that day's warning, so both at once is a data
    // problem. Showing it surfaces the problem rather than hiding it behind
    // a calm blue dot.
    expect(dailyReportDayState({ submission_status: 'MISSING', leave_status: 'APPROVED', ...WARN })).toEqual({
      state: 'warned',
      label: 'On leave — warning recorded'
    });
  });

  it('beats a draft', () => {
    expect(dailyReportDayState({ submission_status: 'DRAFT', ...WARN }).label).toBe('Draft only — warning recorded');
  });

  it('ignores a warning that is not ACTIVE, e.g. one already waived', () => {
    expect(dailyReportDayState({ submission_status: 'MISSING', warning_status: 'WAIVED' })).toEqual({
      state: 'missing',
      label: 'Missing'
    });
  });
});

describe('nothing known about the day', () => {
  it('falls back to missing rather than throwing', () => {
    expect(dailyReportDayState({}).state).toBe('missing');
  });
});
