// Department "health" scoring for the Dashboard's traffic-light gauges.
// Every score is a 0-100 percentage of a positive outcome, averaged PER
// TEAM MEMBER (not derived from pooled totals) — a team of one senior rep
// and one brand-new rep counts each person's own % equally, matching
// "average review of team" rather than weighting by volume. A department
// with no matching formula below (or with nobody having any scoreable
// activity yet) returns the 'na' band instead of a fabricated number.
import { searchQuotationsFiltered } from './quotationStore';
import { projectStore } from './projectStore';
import { marketingRequestStore } from './marketingRequestStore';
import { tmsBomRequestStore } from './tmsBomRequestStore';
import { deliveryChallanStore } from './deliveryChallanStore';
import { needsFollowUp } from './followUp';
import { ProjectRecord, QuotationRecord, MarketingRequestRecord, TmsBomRequestRecord } from './types';

// Several department scorers below need the same org-wide dataset (e.g.
// every department mapped to scoreSalesTeam/scoreTechTeam runs once per
// department — Sales + GEM - Sales, or AV + Robotics + AI — via
// Promise.all in the dashboard/health route). Without this, each of those
// concurrent calls independently re-ran the same full-table query. A cache
// object created once per request and threaded through every
// computeDepartmentScore() call de-dupes them: the check-then-set below is
// synchronous (no await between them), so concurrent callers racing for the
// same key all await the one in-flight promise instead of starting their own.
export interface ScoringDataCache {
  projects?: Promise<ProjectRecord[]>;
  quotations?: Promise<QuotationRecord[]>;
  marketingRequests?: Promise<MarketingRequestRecord[]>;
  tmsBomRequests?: Promise<TmsBomRequestRecord[]>;
}

function getProjects(cache: ScoringDataCache): Promise<ProjectRecord[]> {
  if (!cache.projects) cache.projects = projectStore.readAllLight();
  return cache.projects;
}

function getQuotations(cache: ScoringDataCache): Promise<QuotationRecord[]> {
  if (!cache.quotations) cache.quotations = searchQuotationsFiltered({});
  return cache.quotations;
}

function getMarketingRequests(cache: ScoringDataCache): Promise<MarketingRequestRecord[]> {
  if (!cache.marketingRequests) cache.marketingRequests = marketingRequestStore.readAll();
  return cache.marketingRequests;
}

function getTmsBomRequests(cache: ScoringDataCache): Promise<TmsBomRequestRecord[]> {
  if (!cache.tmsBomRequests) cache.tmsBomRequests = tmsBomRequestStore.list();
  return cache.tmsBomRequests;
}

export type ScoreBand = 'red' | 'yellow' | 'green' | 'na';

export interface BreakdownRow {
  label: string;
  value: string;
}

// Each scorer already computed a per-member percentage in order to average
// it — this exposes those individual figures instead of discarding them, so a
// department can be opened up and read person by person rather than as a
// single opaque number. `score: null` means that member has no scoreable
// activity yet and was therefore excluded from the department average (not
// that they scored zero — an important distinction for a performance figure).
export interface MemberScore {
  id: string;
  username: string;
  score: number | null;
  metrics: BreakdownRow[];
}

export interface ScoreResult {
  score: number;
  band: ScoreBand;
  breakdown: BreakdownRow[];
  members: MemberScore[];
  /** Plain-language description of what this department's score measures. */
  formula: string;
}

export interface TeamMember {
  id: string;
  username: string;
}

const NO_FORMULA = 'No health metric is defined for this department yet.';

function naResult(team: TeamMember[] = [], formula = NO_FORMULA): ScoreResult {
  return {
    score: 0,
    band: 'na',
    breakdown: [],
    // Still list the roster so an "unscored" department can be inspected —
    // knowing who is in it is useful even when there's no number.
    members: team.map((m) => ({ id: m.id, username: m.username, score: null, metrics: [] })),
    formula
  };
}

export function scoreBand(score: number): 'red' | 'yellow' | 'green' {
  if (score >= 70) return 'green';
  if (score >= 40) return 'yellow';
  return 'red';
}

function average(nums: number[]): number | null {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

function pct(numerator: number, denominator: number): number | null {
  return denominator > 0 ? (numerator / denominator) * 100 : null;
}

function finalize(members: MemberScore[], breakdown: BreakdownRow[], formula: string): ScoreResult {
  const defined = members.map((m) => m.score).filter((p): p is number => p !== null);
  const avg = average(defined);
  if (avg === null) {
    // Nobody has scoreable activity — 'na' band, but keep the roster and the
    // formula so the detail view can explain *why* there's no number.
    return { score: 0, band: 'na', breakdown: [], members, formula };
  }
  const score = Math.round(avg);
  return {
    score,
    band: scoreBand(score),
    breakdown,
    // Highest first, then unscored members last — reads as a ranking.
    members: [...members].sort((a, b) => {
      if (a.score === null && b.score === null) return a.username.localeCompare(b.username);
      if (a.score === null) return 1;
      if (b.score === null) return -1;
      return b.score - a.score;
    }),
    formula
  };
}

function rounded(p: number | null): number | null {
  return p === null ? null : Math.round(p);
}

// ---------------------------------------------------------------------------
// Sales (Sales, GEM - Sales) — won rate, quotation conversion, follow-up
// health, averaged per rep.
// ---------------------------------------------------------------------------
const SALES_FORMULA =
  'The average of three rates per rep — deals won vs lost, quotations converted to approved, and quotations whose follow-up is not overdue — then averaged across the team.';

async function scoreSalesTeam(team: TeamMember[], cache: ScoringDataCache): Promise<ScoreResult> {
  if (!team.length) return naResult(team, SALES_FORMULA);

  const [allQuotations, allProjects] = await Promise.all([getQuotations(cache), getProjects(cache)]);

  let totalWon = 0, totalLost = 0, totalQuotations = 0, totalConverted = 0, totalOverdue = 0, totalTracked = 0;

  const members: MemberScore[] = team.map((m) => {
    const quotations = allQuotations.filter((q) => q.created_by === m.username);
    const projects = allProjects.filter((p) => p.created_by === m.username);

    const won = projects.filter((p) => p.status === 'won').length;
    const lost = projects.filter((p) => p.status === 'lost').length;
    const created = quotations.length;
    const converted = quotations.filter((q) => q.status === 'approved').length;

    let overdue = 0, tracked = 0;
    quotations.forEach((q) => {
      tracked += 1;
      if (needsFollowUp(q)) overdue += 1;
    });

    totalWon += won; totalLost += lost; totalQuotations += created; totalConverted += converted;
    totalOverdue += overdue; totalTracked += tracked;

    const components = [pct(won, won + lost), pct(converted, created), pct(tracked - overdue, tracked)].filter(
      (p): p is number => p !== null
    );
    return {
      id: m.id,
      username: m.username,
      score: rounded(average(components)),
      metrics: [
        { label: 'Won / Lost deals', value: `${won} / ${lost}` },
        { label: 'Quotations converted', value: `${converted} / ${created}` },
        { label: 'Follow-ups on track', value: `${tracked - overdue} / ${tracked}` }
      ]
    };
  });

  const breakdown: BreakdownRow[] = [
    { label: 'Won / Lost deals', value: `${totalWon} / ${totalLost}` },
    { label: 'Quotations converted', value: `${totalConverted} / ${totalQuotations}` },
    { label: 'Follow-ups on track', value: `${totalTracked - totalOverdue} / ${totalTracked}` }
  ];
  return finalize(members, breakdown, SALES_FORMULA);
}

// ---------------------------------------------------------------------------
// Tech (AV, Robotics, AI) — % of a member's active-assigned projects that
// aren't past their expected closing date.
// ---------------------------------------------------------------------------
const TECH_FORMULA =
  'The share of each engineer’s actively-assigned projects that have not passed their expected closing date, averaged across the team.';

async function scoreTechTeam(team: TeamMember[], cache: ScoringDataCache): Promise<ScoreResult> {
  if (!team.length) return naResult(team, TECH_FORMULA);
  const allProjects = await getProjects(cache);
  const today = new Date().toISOString().slice(0, 10);

  let totalActive = 0, totalDelayed = 0;

  const members: MemberScore[] = team.map((m) => {
    const assigned = allProjects.filter((p) => p.assigned_technical_person_id === m.id && p.status === 'active');
    const delayed = assigned.filter((p) => p.expected_closing_date && p.expected_closing_date < today);
    totalActive += assigned.length; totalDelayed += delayed.length;
    return {
      id: m.id,
      username: m.username,
      score: rounded(pct(assigned.length - delayed.length, assigned.length)),
      metrics: [
        { label: 'On-track projects', value: `${assigned.length - delayed.length} / ${assigned.length}` },
        { label: 'Overdue projects', value: String(delayed.length) }
      ]
    };
  });

  const breakdown: BreakdownRow[] = [{ label: 'On-track projects', value: `${totalActive - totalDelayed} / ${totalActive}` }];
  return finalize(members, breakdown, TECH_FORMULA);
}

// ---------------------------------------------------------------------------
// Marketing — % of a member's requests delivered on or before their
// needed-by date.
// ---------------------------------------------------------------------------
const MARKETING_FORMULA =
  'The share of each member’s deadline-bearing requests that were completed on or before the needed-by date, averaged across the team. Requests still open past their deadline count against the score.';

async function scoreMarketingTeam(team: TeamMember[], cache: ScoringDataCache): Promise<ScoreResult> {
  if (!team.length) return naResult(team, MARKETING_FORMULA);
  const usernameById = new Map(team.map((m) => [m.id, m.username]));
  const all = await getMarketingRequests(cache);
  const today = new Date().toISOString().slice(0, 10);

  let totalOnTime = 0, totalLate = 0, totalOverdueOpen = 0;

  const members: MemberScore[] = team.map((m) => {
    const mine = all.filter((r) => r.created_by === m.username || (r.assigned_to_id && usernameById.get(r.assigned_to_id) === m.username));
    const withDeadline = mine.filter((r) => r.needed_by_date);

    let onTime = 0, late = 0, overdueOpen = 0;
    withDeadline.forEach((r) => {
      if (r.status === 'completed') {
        if (r.updated_at.slice(0, 10) <= r.needed_by_date) onTime += 1;
        else late += 1;
      } else if (r.needed_by_date < today) {
        overdueOpen += 1;
      }
    });

    totalOnTime += onTime; totalLate += late; totalOverdueOpen += overdueOpen;
    return {
      id: m.id,
      username: m.username,
      score: rounded(pct(onTime, onTime + late + overdueOpen)),
      metrics: [
        { label: 'Delivered on time', value: `${onTime} / ${onTime + late + overdueOpen}` },
        { label: 'Delivered late', value: String(late) },
        { label: 'Open past deadline', value: String(overdueOpen) }
      ]
    };
  });

  const breakdown: BreakdownRow[] = [
    { label: 'Delivered on time', value: `${totalOnTime} / ${totalOnTime + totalLate + totalOverdueOpen}` }
  ];
  return finalize(members, breakdown, MARKETING_FORMULA);
}

// ---------------------------------------------------------------------------
// Back Office — % of a member's Delivery Challans that have moved past
// "prepared" (dispatched, returned, or closed).
// ---------------------------------------------------------------------------
const BACKOFFICE_FORMULA =
  'The share of each member’s Delivery Challans that have moved beyond "prepared" — dispatched, returned or closed — averaged across the team.';

async function scoreBackOfficeTeam(team: TeamMember[], _cache: ScoringDataCache): Promise<ScoreResult> {
  if (!team.length) return naResult(team, BACKOFFICE_FORMULA);
  let totalMoved = 0, totalDcs = 0;

  const members: MemberScore[] = await Promise.all(
    team.map(async (m) => {
      const dcs = await deliveryChallanStore.listOwnedBy(m.username);
      const moved = dcs.filter((d) => d.status !== 'prepared').length;
      totalMoved += moved; totalDcs += dcs.length;
      return {
        id: m.id,
        username: m.username,
        score: rounded(pct(moved, dcs.length)),
        metrics: [
          { label: 'DCs moved past preparation', value: `${moved} / ${dcs.length}` },
          { label: 'Still awaiting dispatch', value: String(dcs.length - moved) }
        ]
      };
    })
  );

  const breakdown: BreakdownRow[] = [{ label: 'DCs moved past preparation', value: `${totalMoved} / ${totalDcs}` }];
  return finalize(members, breakdown, BACKOFFICE_FORMULA);
}

// ---------------------------------------------------------------------------
// Accounts — % of finance-approved BOM requests this member marked paid
// within 3 days.
// ---------------------------------------------------------------------------
const ACCOUNTS_TARGET_DAYS = 3;
const ADMINISTRATION_TARGET_DAYS = 2;

function daysBetween(fromIso: string, toIso: string): number {
  return (new Date(toIso).getTime() - new Date(fromIso).getTime()) / 86_400_000;
}

const ACCOUNTS_FORMULA =
  `The share of finance-approved BOM requests each member marked as paid within ${ACCOUNTS_TARGET_DAYS} days of that approval, averaged across the team.`;

async function scoreAccountsTeam(team: TeamMember[], cache: ScoringDataCache): Promise<ScoreResult> {
  if (!team.length) return naResult(team, ACCOUNTS_FORMULA);
  const all = await getTmsBomRequests(cache);
  let totalOnTime = 0, totalHandled = 0;

  const members: MemberScore[] = team.map((m) => {
    const handled = all.filter((r) => r.payment_marked_by_id === m.id && r.finance_reviewed_at);
    const onTime = handled.filter((r) => daysBetween(r.finance_reviewed_at, r.payment_marked_at) <= ACCOUNTS_TARGET_DAYS);
    totalOnTime += onTime.length; totalHandled += handled.length;
    return {
      id: m.id,
      username: m.username,
      score: rounded(pct(onTime.length, handled.length)),
      metrics: [
        { label: `Paid within ${ACCOUNTS_TARGET_DAYS} days`, value: `${onTime.length} / ${handled.length}` },
        { label: 'Payments handled', value: String(handled.length) }
      ]
    };
  });

  const breakdown: BreakdownRow[] = [{ label: `Payments marked within ${ACCOUNTS_TARGET_DAYS} days`, value: `${totalOnTime} / ${totalHandled}` }];
  return finalize(members, breakdown, ACCOUNTS_FORMULA);
}

// ---------------------------------------------------------------------------
// Administration — % of technical-manager-approved BOM requests this member
// admin-approved within 2 days.
// ---------------------------------------------------------------------------
const ADMINISTRATION_FORMULA =
  `The share of technical-manager-approved BOM requests each member admin-approved within ${ADMINISTRATION_TARGET_DAYS} days, averaged across the team.`;

async function scoreAdministrationTeam(team: TeamMember[], cache: ScoringDataCache): Promise<ScoreResult> {
  if (!team.length) return naResult(team, ADMINISTRATION_FORMULA);
  const all = await getTmsBomRequests(cache);
  let totalOnTime = 0, totalHandled = 0;

  const members: MemberScore[] = team.map((m) => {
    const handled = all.filter((r) => r.admin_reviewed_by_id === m.id && r.reviewed_at);
    const onTime = handled.filter((r) => daysBetween(r.reviewed_at, r.admin_reviewed_at) <= ADMINISTRATION_TARGET_DAYS);
    totalOnTime += onTime.length; totalHandled += handled.length;
    return {
      id: m.id,
      username: m.username,
      score: rounded(pct(onTime.length, handled.length)),
      metrics: [
        { label: `Approved within ${ADMINISTRATION_TARGET_DAYS} days`, value: `${onTime.length} / ${handled.length}` },
        { label: 'Approvals handled', value: String(handled.length) }
      ]
    };
  });

  const breakdown: BreakdownRow[] = [{ label: `Approvals within ${ADMINISTRATION_TARGET_DAYS} days`, value: `${totalOnTime} / ${totalHandled}` }];
  return finalize(members, breakdown, ADMINISTRATION_FORMULA);
}

// ---------------------------------------------------------------------------
// Registry — add one more entry here when a department gets a real metric;
// anything not listed renders the neutral "not enough data" gauge state.
// ---------------------------------------------------------------------------
const DEPARTMENT_SCORERS: Record<string, (team: TeamMember[], cache: ScoringDataCache) => Promise<ScoreResult>> = {
  Sales: scoreSalesTeam,
  'GEM - Sales': scoreSalesTeam,
  AV: scoreTechTeam,
  Robotics: scoreTechTeam,
  AI: scoreTechTeam,
  Marketing: scoreMarketingTeam,
  'Back Office': scoreBackOfficeTeam,
  Accounts: scoreAccountsTeam,
  Administration: scoreAdministrationTeam
};

// `cache` is optional so a single self-only lookup (dashboard/health's
// non-org-wide branch) doesn't need to bother creating one — but callers
// scoring multiple departments in the same request (Promise.all over every
// active department) MUST create one ScoringDataCache and pass the SAME
// object into every call, or the whole point of caching is lost.
export async function computeDepartmentScore(departmentName: string, team: TeamMember[], cache: ScoringDataCache = {}): Promise<ScoreResult> {
  const scorer = DEPARTMENT_SCORERS[departmentName];
  if (!scorer) return naResult(team);
  return scorer(team, cache);
}

/** Band thresholds, exported so the UI legend can't drift from scoreBand(). */
export const BAND_THRESHOLDS = { green: 70, yellow: 40 } as const;
