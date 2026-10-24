import { describe, it, expect } from 'vitest';
import {
  AnalyticsDemoRow,
  AnalyticsProjectRow,
  computeDepartmentBreakdown,
  computeMonthlyTrend,
  computePartnerKpis
} from '../../lib/partnerAnalyticsCompute';

function project(over: Partial<AnalyticsProjectRow> = {}): AnalyticsProjectRow {
  return {
    id: Math.random().toString(36).slice(2),
    partner_submission_status: 'approved',
    status: 'active',
    stage: 'quotation',
    departments: ['av'],
    partner_submitted_value: 1000,
    approx_price: 900,
    created_at: '2026-10-01T00:00:00.000Z',
    ...over
  };
}

function demo(status: string): AnalyticsDemoRow {
  return { id: Math.random().toString(36).slice(2), status, created_at: '2026-10-01T00:00:00.000Z' };
}

describe('computePartnerKpis — the money rule', () => {
  // The three value kinds must never be merged. Summing partner estimates
  // into anything labelled revenue would let wishful numbers read as
  // realised business.
  const projects = [
    project({ partner_submission_status: 'submitted', partner_submitted_value: 5000, approx_price: '' }),
    project({ partner_submission_status: 'approved', status: 'active', partner_submitted_value: 2000, approx_price: 1800 }),
    project({ partner_submission_status: 'approved', status: 'won', partner_submitted_value: 3000, approx_price: 2500 }),
    project({ partner_submission_status: 'rejected', partner_submitted_value: 9000, approx_price: '' })
  ];

  const kpis = computePartnerKpis(projects, [], 0);

  it('counts every submitted estimate, reviewed or not', () => {
    expect(kpis.estimatedValueSubmitted).toBe(5000 + 2000 + 3000 + 9000);
  });

  it('counts our own figure only for accepted projects', () => {
    expect(kpis.quotedValueApproved).toBe(1800 + 2500);
  });

  it('counts won business only for won projects, at our figure', () => {
    expect(kpis.wonValue).toBe(2500);
    // Emphatically NOT the partner's 3000 estimate for the same deal.
    expect(kpis.wonValue).not.toBe(3000);
  });

  it('exposes no merged total that could be mistaken for revenue', () => {
    expect(kpis).not.toHaveProperty('totalValue');
    expect(kpis).not.toHaveProperty('revenue');
  });

  it('ignores a missing estimate rather than counting it as zero-valued noise', () => {
    const k = computePartnerKpis([project({ partner_submitted_value: '', approx_price: '' })], [], 0);
    expect(k.estimatedValueSubmitted).toBe(0);
    expect(k.quotedValueApproved).toBe(0);
  });
});

describe('computePartnerKpis — counts and rates', () => {
  it('separates awaiting review from decided', () => {
    const k = computePartnerKpis(
      [
        project({ partner_submission_status: 'submitted' }),
        project({ partner_submission_status: 'info_requested' }),
        project({ partner_submission_status: 'approved' })
      ],
      [],
      0
    );
    expect(k.awaitingReview).toBe(2);
    expect(k.approved).toBe(1);
  });

  it('excludes on-hold projects from the active count', () => {
    // On hold is neither progressing nor closed; counting it as active would
    // inflate what reads as live pipeline.
    const k = computePartnerKpis(
      [project({ status: 'active' }), project({ status: 'on_hold' })],
      [],
      0
    );
    expect(k.active).toBe(1);
  });

  it('returns null rates when nothing has happened yet', () => {
    // "0% win rate" and "nothing has closed yet" are different statements,
    // and a partner reading the first when the second is true would
    // reasonably conclude we think they are failing.
    const k = computePartnerKpis([project({ partner_submission_status: 'submitted' })], [], 0);
    expect(k.winRate).toBeNull();
    expect(k.approvalRate).toBeNull();
    expect(k.demoCompletionRate).toBeNull();
  });

  it('computes a win rate over closed deals only', () => {
    const k = computePartnerKpis(
      [
        project({ status: 'won' }),
        project({ status: 'lost' }),
        project({ status: 'lost' }),
        project({ status: 'active' })
      ],
      [],
      0
    );
    // 1 won of 3 closed — the still-active project is not a loss.
    expect(k.winRate).toBe(33.3);
  });

  it('excludes cancelled demos from the completion denominator', () => {
    // A withdrawn request was never a demo anyone failed to complete.
    const k = computePartnerKpis([], [demo('demo_completed'), demo('cancelled'), demo('pending_manager')], 0);
    expect(k.demosRequested).toBe(3);
    expect(k.demosCompleted).toBe(1);
    expect(k.demoCompletionRate).toBe(50);
  });
});

describe('computeMonthlyTrend', () => {
  const now = new Date('2026-10-15T00:00:00.000Z');

  it('emits a point for every month, including empty ones', () => {
    // A sparse series plotted as a line connects across gaps and makes a
    // quiet quarter look like steady activity.
    const points = computeMonthlyTrend([], 12, now);
    expect(points).toHaveLength(12);
    expect(points.every((p) => p.submitted === 0)).toBe(true);
    expect(points[11].month).toBe('2026-10');
    expect(points[0].month).toBe('2025-11');
  });

  it('buckets projects into their submission month', () => {
    const points = computeMonthlyTrend(
      [
        project({ created_at: '2026-10-02T00:00:00.000Z', status: 'won' }),
        project({ created_at: '2026-09-20T00:00:00.000Z', partner_submission_status: 'approved' })
      ],
      12,
      now
    );
    const october = points.find((p) => p.month === '2026-10');
    expect(october?.submitted).toBe(1);
    expect(october?.won).toBe(1);
    expect(points.find((p) => p.month === '2026-09')?.approved).toBe(1);
  });

  it('silently drops rows outside the window and unparseable dates', () => {
    const points = computeMonthlyTrend(
      [project({ created_at: '2019-01-01T00:00:00.000Z' }), project({ created_at: 'not a date' })],
      12,
      now
    );
    expect(points.reduce((sum, p) => sum + p.submitted, 0)).toBe(0);
  });
});

describe('computeDepartmentBreakdown', () => {
  it('counts a multi-department project once in each', () => {
    // This answers "how much AV work is this partner bringing", and a
    // two-department deal genuinely brings both — so the counts need not sum
    // to the project total.
    const points = computeDepartmentBreakdown([project({ departments: ['av', 'ai'] }), project({ departments: ['av'] })]);
    expect(points).toEqual([
      { department: 'av', count: 2 },
      { department: 'ai', count: 1 }
    ]);
  });

  it('buckets projects with no department under unspecified', () => {
    expect(computeDepartmentBreakdown([project({ departments: [] })])).toEqual([{ department: 'unspecified', count: 1 }]);
  });
});
