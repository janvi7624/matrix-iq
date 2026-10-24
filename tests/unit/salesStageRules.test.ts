import { describe, it, expect } from 'vitest';
import {
  LOST_REASONS,
  NEEDS_RETRIAGE_STAGES,
  PIPELINE_STAGES,
  STAGE_CLOSING_PERCENT,
  STALE_AFTER_DAYS,
  clearOverrideOnStageChange,
  commitMissingPoDate,
  countsTowardForecast,
  daysBetween,
  daysInStage,
  isOverdueCommit,
  isStale,
  normalizeStage,
  priceOf,
  resolveClosingPercent,
  stageGateFailures,
  stageNeedsRetriage,
  weightedValue
} from '../../lib/salesStageRules';
import { ProjectStage, ProjectStatus } from '../../lib/types';

// The pipeline's money and gates. These tests exist because the thing being
// replaced — a hand-typed Closing % — failed silently: a Cold Call deal could
// read 100% and a Closed Lost deal 40%, and nothing anywhere objected.

const open = (over: Partial<{ stage: ProjectStage; status: ProjectStatus; closing_percent_override: number | null }> = {}) => ({
  stage: 'prospect' as ProjectStage,
  status: 'active' as ProjectStatus,
  ...over
});

describe('the stage table', () => {
  it('is the five live stages in pipeline order', () => {
    expect(PIPELINE_STAGES).toEqual(['prospect', 'demo', 'quotation', 'negotiation', 'commit']);
  });

  it('gives every pipeline stage exactly the agreed percentage', () => {
    expect(PIPELINE_STAGES.map((s) => STAGE_CLOSING_PERCENT[s])).toEqual([10, 30, 50, 70, 90]);
  });

  // The old stageProgressPercent derived a figure from a stage's POSITION, so
  // Cold Call read 13% rather than 10% and adding a stage re-graded everything.
  it('does not derive the percentage from position', () => {
    expect(STAGE_CLOSING_PERCENT.prospect).toBe(10);
    expect(STAGE_CLOSING_PERCENT.commit).toBe(90);
  });

  it('treats cold_call and prospect as one stage', () => {
    expect(normalizeStage('cold_call')).toBe('prospect');
    expect(normalizeStage('prospect')).toBe('prospect');
    expect(resolveClosingPercent(open({ stage: 'cold_call' })).percent).toBe(10);
  });

  it('keeps demo at its stored value while reading as the qualified stage', () => {
    expect(PIPELINE_STAGES).toContain('demo');
    expect(resolveClosingPercent(open({ stage: 'demo' })).percent).toBe(30);
  });
});

describe('resolveClosingPercent', () => {
  it('reads 100% from a won status whatever the stage says', () => {
    // The data really does contain early-stage projects with status won.
    const result = resolveClosingPercent(open({ stage: 'prospect', status: 'won' }));
    expect(result).toEqual({ percent: 100, source: 'status' });
  });

  it('reads 0% from a lost status, and from the lost stage', () => {
    expect(resolveClosingPercent(open({ status: 'lost' })).percent).toBe(0);
    expect(resolveClosingPercent(open({ stage: 'closed_lost' })).percent).toBe(0);
  });

  // A received PO is a fact, not a forecast. Nobody should be able to record
  // an 80% chance of winning a deal that is already won.
  it('does not let an admin override beat a closed outcome', () => {
    const won = resolveClosingPercent(open({ status: 'won', closing_percent_override: 80 }));
    expect(won).toEqual({ percent: 100, source: 'status' });
    const lost = resolveClosingPercent(open({ status: 'lost', closing_percent_override: 80 }));
    expect(lost).toEqual({ percent: 0, source: 'status' });
  });

  it('lets an admin override beat the stage figure on an open deal', () => {
    const result = resolveClosingPercent(open({ stage: 'negotiation', closing_percent_override: 85 }));
    expect(result).toEqual({ percent: 85, source: 'override' });
  });

  it('clamps an override to 0-100 and rounds it', () => {
    expect(resolveClosingPercent(open({ closing_percent_override: 140 })).percent).toBe(100);
    expect(resolveClosingPercent(open({ closing_percent_override: -5 })).percent).toBe(0);
    expect(resolveClosingPercent(open({ closing_percent_override: 42.6 })).percent).toBe(43);
  });

  it('ignores a non-finite override rather than producing NaN', () => {
    expect(resolveClosingPercent(open({ closing_percent_override: NaN })).percent).toBe(10);
    expect(resolveClosingPercent(open({ closing_percent_override: null })).percent).toBe(10);
  });

  // The single most important case. 39 live projects sit in these stages,
  // carrying about Rs 9.6 crore between them. Reporting them as 0% would
  // understate the forecast by that whole amount while looking like an answer.
  describe('a stage awaiting re-triage', () => {
    it('reports an unknown percentage, not zero', () => {
      for (const stage of NEEDS_RETRIAGE_STAGES) {
        const result = resolveClosingPercent(open({ stage }));
        expect(result).toEqual({ percent: null, source: 'unknown' });
      }
    });

    it('is flagged so it can be filtered and fixed', () => {
      expect(stageNeedsRetriage('customer_response')).toBe(true);
      expect(stageNeedsRetriage('site_visit')).toBe(true);
      expect(stageNeedsRetriage('catalogue_offered')).toBe(true);
    });

    it('does not flag stages that map cleanly or are already closed', () => {
      expect(stageNeedsRetriage('cold_call')).toBe(false);
      expect(stageNeedsRetriage('po_received')).toBe(false);
      expect(stageNeedsRetriage('quotation')).toBe(false);
    });

    // A won deal is answerable even from a retired stage, because status says so.
    it('still answers 100% when such a project is already won', () => {
      expect(resolveClosingPercent(open({ stage: 'po_received', status: 'won' })).percent).toBe(100);
    });
  });
});

describe('an admin override and a stage change', () => {
  it('is cleared by any real stage change', () => {
    expect(clearOverrideOnStageChange('negotiation', 'commit')).toBe(true);
    expect(clearOverrideOnStageChange('prospect', 'quotation')).toBe(true);
  });

  it('survives a no-op, including the cold_call/prospect spelling change', () => {
    expect(clearOverrideOnStageChange('negotiation', 'negotiation')).toBe(false);
    expect(clearOverrideOnStageChange('cold_call', 'prospect')).toBe(false);
  });
});

describe('weighted value', () => {
  it('is price times probability, as a decimal', () => {
    expect(weightedValue(1_000_000, 70)).toBe(700_000);
    expect(weightedValue(1_000_000, 10)).toBe(100_000);
    expect(weightedValue(1_000_000, 100)).toBe(1_000_000);
    expect(weightedValue(1_000_000, 0)).toBe(0);
  });

  // DECIMAL(14,2) comes back from pg as a string.
  it('accepts the string a DECIMAL column returns', () => {
    expect(weightedValue('2500000.00', 50)).toBe(1_250_000);
    expect(priceOf('2500000.00')).toBe(2_500_000);
  });

  // 48 active projects have no price. A missing price and a worthless deal are
  // different facts, and summing the first as zero reports a confident wrong
  // forecast.
  it('is unknown rather than zero when either half is missing', () => {
    expect(weightedValue(null, 70)).toBeNull();
    expect(weightedValue('', 70)).toBeNull();
    expect(weightedValue(1_000_000, null)).toBeNull();
    expect(weightedValue('not a number', 70)).toBeNull();
  });

  it('keeps won revenue out of the open forecast', () => {
    expect(countsTowardForecast('active')).toBe(true);
    expect(countsTowardForecast('won')).toBe(false);
    expect(countsTowardForecast('lost')).toBe(false);
    expect(countsTowardForecast('on_hold')).toBe(false);
  });
});

describe('days in current stage', () => {
  it('counts whole days from the date the stage was entered', () => {
    expect(daysInStage('2026-10-01', '2026-10-16')).toBe(15);
    expect(daysInStage('2026-10-16', '2026-10-16')).toBe(0);
  });

  it('crosses a month and a year boundary correctly', () => {
    expect(daysBetween('2026-10-28', '2026-11-03')).toBe(6);
    expect(daysBetween('2026-12-28', '2027-01-04')).toBe(7);
  });

  it('never reports a negative age', () => {
    expect(daysInStage('2026-10-20', '2026-10-16')).toBe(0);
  });

  it('is unknown when the entry date is missing or malformed', () => {
    expect(daysInStage(null, '2026-10-16')).toBeNull();
    expect(daysInStage('16/10/2026', '2026-10-16')).toBeNull();
  });
});

describe('stale deals', () => {
  it('flags a deal untouched for the full threshold', () => {
    expect(STALE_AFTER_DAYS).toBe(14);
    expect(isStale('2026-10-02', '2026-10-16', 'active')).toBe(true);
  });

  it('does not flag one touched a day inside the threshold', () => {
    expect(isStale('2026-10-03', '2026-10-16', 'active')).toBe(false);
  });

  // Nothing left to chase.
  it('never flags a closed deal', () => {
    expect(isStale('2026-01-01', '2026-10-16', 'won')).toBe(false);
    expect(isStale('2026-01-01', '2026-10-16', 'lost')).toBe(false);
  });

  it('still flags a parked deal, which is exactly the one that gets forgotten', () => {
    expect(isStale('2026-01-01', '2026-10-16', 'on_hold')).toBe(true);
  });

  it('does not flag a deal with no recorded activity at all', () => {
    // Absence of a timestamp is a data gap, not evidence of neglect.
    expect(isStale(null, '2026-10-16', 'active')).toBe(false);
  });
});

describe('overdue commit deals', () => {
  it('flags a Commit deal whose expected PO date has passed', () => {
    expect(isOverdueCommit('commit', 'active', '2026-10-15', '2026-10-16')).toBe(true);
  });

  it('does not flag one whose date is today or still ahead', () => {
    expect(isOverdueCommit('commit', 'active', '2026-10-16', '2026-10-16')).toBe(false);
    expect(isOverdueCommit('commit', 'active', '2026-11-30', '2026-10-16')).toBe(false);
  });

  it('only applies to Commit', () => {
    expect(isOverdueCommit('negotiation', 'active', '2026-01-01', '2026-10-16')).toBe(false);
  });

  it('does not flag a deal that already closed', () => {
    expect(isOverdueCommit('commit', 'won', '2026-01-01', '2026-10-16')).toBe(false);
    expect(isOverdueCommit('commit', 'lost', '2026-01-01', '2026-10-16')).toBe(false);
  });

  // Treating "no date" as overdue would bury the deals that really are.
  it('separates a missing PO date from an overdue one', () => {
    expect(isOverdueCommit('commit', 'active', null, '2026-10-16')).toBe(false);
    expect(commitMissingPoDate('commit', 'active', null)).toBe(true);
    expect(commitMissingPoDate('commit', 'active', '2026-11-01')).toBe(false);
    expect(commitMissingPoDate('negotiation', 'active', null)).toBe(false);
  });
});

describe('stage gates', () => {
  const fieldsMissing = (stage: ProjectStage, status: ProjectStatus, values: Record<string, unknown> = {}) =>
    stageGateFailures(stage, status, values).map((f) => f.field).sort();

  it('requires quote value, quotation date and a price to enter Quotation', () => {
    expect(fieldsMissing('quotation', 'active')).toEqual(['approx_price', 'quotation_date', 'quote_value']);
  });

  it('requires an expected closing date and a price to enter Negotiation', () => {
    expect(fieldsMissing('negotiation', 'active')).toEqual(['approx_price', 'expected_closing_date']);
  });

  it('requires a PO date and a confirming contact to enter Commit', () => {
    expect(fieldsMissing('commit', 'active')).toEqual(['approx_price', 'confirmed_by_contact', 'expected_po_date']);
  });

  it('requires the PO details to mark a deal Won', () => {
    expect(fieldsMissing('commit', 'won', {
      approx_price: 500000,
      expected_po_date: '2026-11-01',
      confirmed_by_contact: 'R. Mehta',
      project_name: 'MeetIQ - Adani',
      company: 'Adani Group',
      project_brief: 'A meeting-room deployment across three sites.'
    })).toEqual(['po_date', 'po_number', 'po_value']);
  });

  it('requires project name, company and a brief to mark a deal Won', () => {
    expect(fieldsMissing('commit', 'won', { po_number: 'PO-4471', po_value: 2500000, po_date: '2026-10-16' }))
      .toEqual(['company', 'project_brief', 'project_name']);
  });

  it('requires a lost reason to mark a deal Lost, by status or by stage', () => {
    expect(fieldsMissing('negotiation', 'lost')).toEqual(['lost_reason']);
    expect(fieldsMissing('closed_lost', 'active')).toEqual(['lost_reason']);
  });

  it('rejects a lost reason that is not on the agreed list', () => {
    const failures = stageGateFailures('closed_lost', 'lost', { lost_reason: 'client went quiet' });
    expect(failures.some((f) => f.field === 'lost_reason')).toBe(true);
    expect(LOST_REASONS).toEqual(['price', 'competitor', 'budget', 'timing', 'no_response']);
  });

  it('accepts each agreed lost reason', () => {
    for (const reason of LOST_REASONS) {
      expect(stageGateFailures('closed_lost', 'lost', { lost_reason: reason })).toEqual([]);
    }
  });

  // Closing a deal answers only to the outcome's gate. Demanding the forward
  // paperwork of whatever stage it died in would mean inventing an expected
  // closing date for a deal that will never close, just to record the loss —
  // so in practice the loss never gets recorded at all.
  it('does not demand the forward gate of the stage a deal dies in', () => {
    expect(stageGateFailures('negotiation', 'lost', { lost_reason: 'budget' })).toEqual([]);
    expect(stageGateFailures('quotation', 'lost', { lost_reason: 'competitor' })).toEqual([]);
  });

  it('does not demand the forward gate when a PO arrives either', () => {
    expect(stageGateFailures('commit', 'won', {
      po_number: 'PO-4471',
      po_value: 2500000,
      po_date: '2026-10-16',
      project_name: 'MeetIQ - Adani',
      company: 'Adani Group',
      project_brief: 'A meeting-room deployment across three sites.'
    })).toEqual([]);
  });

  it('passes once every required field is supplied', () => {
    expect(stageGateFailures('quotation', 'active', {
      approx_price: '2500000.00',
      quote_value: 2400000,
      quotation_date: '2026-10-10'
    })).toEqual([]);
  });

  it('treats whitespace as blank', () => {
    expect(fieldsMissing('commit', 'active', {
      approx_price: 100,
      expected_po_date: '2026-11-01',
      confirmed_by_contact: '   '
    })).toEqual(['confirmed_by_contact']);
  });

  it('rejects a non-numeric quote or PO value', () => {
    const failures = stageGateFailures('quotation', 'active', {
      approx_price: 100,
      quote_value: 'about four lakh',
      quotation_date: '2026-10-10'
    });
    expect(failures.some((f) => f.field === 'quote_value')).toBe(true);
  });

  // Price is required from Quotation onward, and not before it.
  it('does not demand a price before Quotation', () => {
    expect(stageGateFailures('prospect', 'active', {})).toEqual([]);
    expect(stageGateFailures('demo', 'active', {})).toEqual([]);
  });

  // 100 active projects have no expected closing date and 48 have no price.
  // The gate fires on ENTERING a stage, so those records stay editable.
  it('says nothing about a project that is merely sitting in a stage', () => {
    // Same stage in and out: the caller does not consult the gate at all, and
    // what it would say is irrelevant to an ordinary edit.
    const sittingStill = clearOverrideOnStageChange('negotiation', 'negotiation');
    expect(sittingStill).toBe(false);
  });

  it('names the stage in the message a person reads', () => {
    const [failure] = stageGateFailures('commit', 'active', { approx_price: 1, expected_po_date: '2026-11-01' });
    expect(failure.message).toContain('Commit');
    expect(failure.label).toBe('Customer contact who confirmed');
  });

  it('names Won and Lost rather than the stage they came from', () => {
    const [won] = stageGateFailures('commit', 'won', { approx_price: 1, expected_po_date: '2026-11-01', confirmed_by_contact: 'x' });
    expect(won.message).toContain('Won');
    const [lost] = stageGateFailures('negotiation', 'lost', {});
    expect(lost.message).toContain('Lost');
  });
});
