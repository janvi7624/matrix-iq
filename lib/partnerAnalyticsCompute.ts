// Partner performance metrics.
//
// Pure computation over plain rows — no Sequelize — so the arithmetic is
// directly testable and can run on the client for a consolidated comparison
// table without a second round trip.
//
// THE MONEY RULE, which drives most of the shape of this file:
// three different kinds of value exist and they must never be added together
// or presented as one number.
//
//   estimated  what the PARTNER guessed when they submitted. Unvetted, often
//              optimistic, sometimes absent. Never revenue.
//   quoted     what WE put in a quotation. Real pricing, but not money we
//              have; most quotations never convert.
//   won        the value of projects actually marked won. The only figure
//              that may be described as business.
//
// The requirement is explicit that these stay distinguishable, and the
// failure mode is specific: summing estimates into something labelled
// "revenue" would let a partner — or an internal manager comparing partners
// — read wishful numbers as realised business. So they are three named
// fields, and there is deliberately no `totalValue` that merges them.

export interface AnalyticsProjectRow {
  id: string;
  partner_submission_status: string;
  status: string;
  stage: string;
  departments: string[];
  /** The partner's own estimate. '' when they gave none. */
  partner_submitted_value: number | '';
  /** Our vetted figure, set by Sales on acceptance. '' when not yet set. */
  approx_price: number | '';
  created_at: string;
}

export interface AnalyticsDemoRow {
  id: string;
  status: string;
  created_at: string;
}

export interface PartnerKpis {
  submitted: number;
  awaitingReview: number;
  approved: number;
  rejected: number;
  active: number;
  won: number;
  lost: number;
  // See THE MONEY RULE above — three separate figures, never merged.
  estimatedValueSubmitted: number;
  quotedValueApproved: number;
  wonValue: number;
  /** Approved ÷ decided. Null when nothing has been decided yet. */
  approvalRate: number | null;
  /** Won ÷ (won + lost). Null when nothing has closed yet. */
  winRate: number | null;
  demosRequested: number;
  demosCompleted: number;
  /** Completed ÷ requested, excluding cancelled. Null when none requested. */
  demoCompletionRate: number | null;
  quotationsShared: number;
}

function num(value: number | ''): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Percentage helper that refuses to invent a denominator.
 *
 * Returns null rather than 0 when nothing has happened yet, because "0% win
 * rate" and "no deals have closed yet" are completely different statements
 * and a partner reading the first when the second is true would reasonably
 * conclude we think they are failing.
 */
function rate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

export function computePartnerKpis(projects: AnalyticsProjectRow[], demos: AnalyticsDemoRow[], quotationsShared: number): PartnerKpis {
  const approvedProjects = projects.filter((p) => p.partner_submission_status === 'approved');
  const rejected = projects.filter((p) => p.partner_submission_status === 'rejected').length;
  const awaitingReview = projects.filter(
    (p) => p.partner_submission_status === 'submitted' || p.partner_submission_status === 'info_requested'
  ).length;

  const won = approvedProjects.filter((p) => p.status === 'won');
  const lost = approvedProjects.filter((p) => p.status === 'lost');
  // "Active" means accepted and still in play — deliberately excludes
  // on_hold, which is neither progressing nor closed and would otherwise
  // inflate the number that reads as live pipeline.
  const active = approvedProjects.filter((p) => p.status === 'active').length;

  const decided = approvedProjects.length + rejected;

  const completedDemos = demos.filter((d) => d.status === 'demo_completed' || d.status === 'material_returned' || d.status === 'dc_closed').length;
  // Cancelled demos are excluded from the denominator: a withdrawn request
  // was never a demo anyone failed to complete.
  const liveDemos = demos.filter((d) => d.status !== 'cancelled').length;

  return {
    submitted: projects.length,
    awaitingReview,
    approved: approvedProjects.length,
    rejected,
    active,
    won: won.length,
    lost: lost.length,
    // Every submission's estimate, including ones still awaiting review —
    // this is "what the partner has brought us", not a forecast.
    estimatedValueSubmitted: projects.reduce((sum, p) => sum + num(p.partner_submitted_value), 0),
    // Only accepted projects, and only OUR figure.
    quotedValueApproved: approvedProjects.reduce((sum, p) => sum + num(p.approx_price), 0),
    // Only won. The single figure that may be called business.
    wonValue: won.reduce((sum, p) => sum + num(p.approx_price), 0),
    approvalRate: rate(approvedProjects.length, decided),
    winRate: rate(won.length, won.length + lost.length),
    demosRequested: demos.length,
    demosCompleted: completedDemos,
    demoCompletionRate: rate(completedDemos, liveDemos),
    quotationsShared
  };
}

export interface MonthlyPoint {
  /** 'YYYY-MM' */
  month: string;
  submitted: number;
  approved: number;
  won: number;
}

/**
 * Submissions per month for a trend chart.
 *
 * Months with no activity are included as zeroes rather than omitted — a
 * sparse series plotted as a line silently connects across the gap and makes
 * a quiet quarter look like steady activity.
 */
export function computeMonthlyTrend(projects: AnalyticsProjectRow[], monthsBack: number, now: Date): MonthlyPoint[] {
  const buckets = new Map<string, MonthlyPoint>();

  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    buckets.set(key, { month: key, submitted: 0, approved: 0, won: 0 });
  }

  for (const project of projects) {
    const at = new Date(project.created_at);
    if (Number.isNaN(at.getTime())) continue;
    const key = `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;
    const bucket = buckets.get(key);
    // Outside the window — not an error, just older than the chart shows.
    if (!bucket) continue;
    bucket.submitted++;
    if (project.partner_submission_status === 'approved') bucket.approved++;
    if (project.status === 'won') bucket.won++;
  }

  return [...buckets.values()];
}

export interface DepartmentBreakdownPoint {
  department: string;
  count: number;
}

/**
 * Projects per delivery department.
 *
 * A project spanning two departments counts once in EACH — this answers
 * "how much AV work is this partner bringing us", and a multi-department
 * deal genuinely brings both. The counts therefore need not sum to the
 * project total, and the UI labels it accordingly rather than presenting it
 * as a partition.
 */
export function computeDepartmentBreakdown(projects: AnalyticsProjectRow[]): DepartmentBreakdownPoint[] {
  const counts = new Map<string, number>();
  for (const project of projects) {
    const departments = project.departments?.length ? project.departments : ['unspecified'];
    for (const department of departments) {
      counts.set(department, (counts.get(department) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([department, count]) => ({ department, count }))
    .sort((a, b) => b.count - a.count);
}
