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

export type ScoreBand = 'red' | 'yellow' | 'green' | 'na';

export interface BreakdownRow {
  label: string;
  value: string;
}

export interface ScoreResult {
  score: number;
  band: ScoreBand;
  breakdown: BreakdownRow[];
}

export interface TeamMember {
  id: string;
  username: string;
}

const NA_RESULT: ScoreResult = { score: 0, band: 'na', breakdown: [] };

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

function finalize(memberPcts: (number | null)[], breakdown: BreakdownRow[]): ScoreResult {
  const defined = memberPcts.filter((p): p is number => p !== null);
  const avg = average(defined);
  if (avg === null) return NA_RESULT;
  const score = Math.round(avg);
  return { score, band: scoreBand(score), breakdown };
}

// ---------------------------------------------------------------------------
// Sales (Sales, GEM - Sales) — won rate, quotation conversion, follow-up
// health, averaged per rep.
// ---------------------------------------------------------------------------
async function scoreSalesTeam(team: TeamMember[]): Promise<ScoreResult> {
  if (!team.length) return NA_RESULT;

  const [allQuotations, allProjects] = await Promise.all([searchQuotationsFiltered({}), projectStore.readAll()]);

  let totalWon = 0, totalLost = 0, totalQuotations = 0, totalConverted = 0, totalOverdue = 0, totalTracked = 0;

  const memberPcts = team.map((m) => {
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
    return average(components);
  });

  const breakdown: BreakdownRow[] = [
    { label: 'Won / Lost deals', value: `${totalWon} / ${totalLost}` },
    { label: 'Quotations converted', value: `${totalConverted} / ${totalQuotations}` },
    { label: 'Follow-ups on track', value: `${totalTracked - totalOverdue} / ${totalTracked}` }
  ];
  return finalize(memberPcts, breakdown);
}

// ---------------------------------------------------------------------------
// Tech (AV, Robotics, AI) — % of a member's active-assigned projects that
// aren't past their expected closing date.
// ---------------------------------------------------------------------------
async function scoreTechTeam(team: TeamMember[]): Promise<ScoreResult> {
  if (!team.length) return NA_RESULT;
  const allProjects = await projectStore.readAll();
  const today = new Date().toISOString().slice(0, 10);

  let totalActive = 0, totalDelayed = 0;

  const memberPcts = team.map((m) => {
    const assigned = allProjects.filter((p) => p.assigned_technical_person_id === m.id && p.status === 'active');
    const delayed = assigned.filter((p) => p.expected_closing_date && p.expected_closing_date < today);
    totalActive += assigned.length; totalDelayed += delayed.length;
    return pct(assigned.length - delayed.length, assigned.length);
  });

  const breakdown: BreakdownRow[] = [{ label: 'On-track projects', value: `${totalActive - totalDelayed} / ${totalActive}` }];
  return finalize(memberPcts, breakdown);
}

// ---------------------------------------------------------------------------
// Marketing — % of a member's requests delivered on or before their
// needed-by date.
// ---------------------------------------------------------------------------
async function scoreMarketingTeam(team: TeamMember[]): Promise<ScoreResult> {
  if (!team.length) return NA_RESULT;
  const usernameById = new Map(team.map((m) => [m.id, m.username]));
  const all = await marketingRequestStore.readAll();
  const today = new Date().toISOString().slice(0, 10);

  let totalOnTime = 0, totalLate = 0, totalOverdueOpen = 0;

  const memberPcts = team.map((m) => {
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
    return pct(onTime, onTime + late + overdueOpen);
  });

  const breakdown: BreakdownRow[] = [
    { label: 'Delivered on time', value: `${totalOnTime} / ${totalOnTime + totalLate + totalOverdueOpen}` }
  ];
  return finalize(memberPcts, breakdown);
}

// ---------------------------------------------------------------------------
// Back Office — % of a member's Delivery Challans that have moved past
// "prepared" (dispatched, returned, or closed).
// ---------------------------------------------------------------------------
async function scoreBackOfficeTeam(team: TeamMember[]): Promise<ScoreResult> {
  if (!team.length) return NA_RESULT;
  let totalMoved = 0, totalDcs = 0;

  const memberPcts = await Promise.all(
    team.map(async (m) => {
      const dcs = await deliveryChallanStore.listOwnedBy(m.username);
      const moved = dcs.filter((d) => d.status !== 'prepared').length;
      totalMoved += moved; totalDcs += dcs.length;
      return pct(moved, dcs.length);
    })
  );

  const breakdown: BreakdownRow[] = [{ label: 'DCs moved past preparation', value: `${totalMoved} / ${totalDcs}` }];
  return finalize(memberPcts, breakdown);
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

async function scoreAccountsTeam(team: TeamMember[]): Promise<ScoreResult> {
  if (!team.length) return NA_RESULT;
  const all = await tmsBomRequestStore.list();
  let totalOnTime = 0, totalHandled = 0;

  const memberPcts = team.map((m) => {
    const handled = all.filter((r) => r.payment_marked_by_id === m.id && r.finance_reviewed_at);
    const onTime = handled.filter((r) => daysBetween(r.finance_reviewed_at, r.payment_marked_at) <= ACCOUNTS_TARGET_DAYS);
    totalOnTime += onTime.length; totalHandled += handled.length;
    return pct(onTime.length, handled.length);
  });

  const breakdown: BreakdownRow[] = [{ label: `Payments marked within ${ACCOUNTS_TARGET_DAYS} days`, value: `${totalOnTime} / ${totalHandled}` }];
  return finalize(memberPcts, breakdown);
}

// ---------------------------------------------------------------------------
// Administration — % of technical-manager-approved BOM requests this member
// admin-approved within 2 days.
// ---------------------------------------------------------------------------
async function scoreAdministrationTeam(team: TeamMember[]): Promise<ScoreResult> {
  if (!team.length) return NA_RESULT;
  const all = await tmsBomRequestStore.list();
  let totalOnTime = 0, totalHandled = 0;

  const memberPcts = team.map((m) => {
    const handled = all.filter((r) => r.admin_reviewed_by_id === m.id && r.reviewed_at);
    const onTime = handled.filter((r) => daysBetween(r.reviewed_at, r.admin_reviewed_at) <= ADMINISTRATION_TARGET_DAYS);
    totalOnTime += onTime.length; totalHandled += handled.length;
    return pct(onTime.length, handled.length);
  });

  const breakdown: BreakdownRow[] = [{ label: `Approvals within ${ADMINISTRATION_TARGET_DAYS} days`, value: `${totalOnTime} / ${totalHandled}` }];
  return finalize(memberPcts, breakdown);
}

// ---------------------------------------------------------------------------
// Registry — add one more entry here when a department gets a real metric;
// anything not listed renders the neutral "not enough data" gauge state.
// ---------------------------------------------------------------------------
const DEPARTMENT_SCORERS: Record<string, (team: TeamMember[]) => Promise<ScoreResult>> = {
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

export async function computeDepartmentScore(departmentName: string, team: TeamMember[]): Promise<ScoreResult> {
  const scorer = DEPARTMENT_SCORERS[departmentName];
  if (!scorer) return NA_RESULT;
  return scorer(team);
}
