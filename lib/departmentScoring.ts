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
import { tmsProjectStore } from './tmsProjectStore';
import { tmsTaskStore } from './tmsTaskStore';
import { tmsProcurementStore } from './tmsProcurementStore';
import { db } from './db';
import { generalTaskStore } from './generalTaskStore';
import { getAllPaymentItems } from './accountsPaymentStore';
import {
  GeneralTaskRecord,
  MarketingRequestRecord,
  PaymentQueueItem,
  ProjectRecord,
  QuotationRecord,
  TmsBomRequestRecord,
  TmsProcurementRecord,
  TmsProjectRecord,
  TmsTaskRecord
} from './types';

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
  // AV, Robotics, AI and R&D all score off the same technical work set —
  // four departments, one query each, exactly what this cache exists for.
  tmsProjects?: Promise<TmsProjectRecord[]>;
  tmsTasks?: Promise<TmsTaskRecord[]>;
  tmsProcurements?: Promise<TmsProcurementRecord[]>;
  reimbursementSheets?: Promise<HrSheetRow[]>;
  adminExpenseEntries?: Promise<HrAdminEntryRow[]>;
  hrTasks?: Promise<GeneralTaskRecord[]>;
  paymentItems?: Promise<PaymentQueueItem[]>;
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

function getTmsProjects(cache: ScoringDataCache): Promise<TmsProjectRecord[]> {
  if (!cache.tmsProjects) cache.tmsProjects = tmsProjectStore.readAll();
  return cache.tmsProjects;
}

function getTmsTasks(cache: ScoringDataCache): Promise<TmsTaskRecord[]> {
  if (!cache.tmsTasks) cache.tmsTasks = tmsTaskStore.readAll();
  return cache.tmsTasks;
}

// HR's approval queue reads two tables directly rather than through a store:
// neither has an unscoped "every row" reader, and adding one to each purely
// for scoring would be more surface than a pair of narrow reads here.
interface HrSheetRow {
  id: string;
  sheet_code: string | null;
  status: string;
  manager_action_at: unknown;
  hr_reviewer_id: string | null;
  hr_reviewed_at: unknown;
  created_at: unknown;
}
interface HrAdminEntryRow {
  id: string;
  approval_status: string;
  approved_by: string | null;
  approved_at: unknown;
  created_at: unknown;
}

function getReimbursementSheets(cache: ScoringDataCache): Promise<HrSheetRow[]> {
  if (!cache.reimbursementSheets) {
    cache.reimbursementSheets = db.ReimbursementSheet.findAll({
      attributes: ['id', 'sheet_code', 'status', 'manager_action_at', 'hr_reviewer_id', 'hr_reviewed_at', 'created_at']
    }).then((rows) => rows.map((r) => r.get({ plain: true }) as unknown as HrSheetRow));
  }
  return cache.reimbursementSheets;
}

function getAdminExpenseEntries(cache: ScoringDataCache): Promise<HrAdminEntryRow[]> {
  if (!cache.adminExpenseEntries) {
    // Admin Expenses are reimbursements flagged is_admin_entry — see
    // lib/accountsPaymentStore.ts's loadAdminExpenseSheets.
    cache.adminExpenseEntries = db.Reimbursement.findAll({
      where: { is_admin_entry: true } as never,
      attributes: ['id', 'approval_status', 'approved_by', 'approved_at', 'created_at']
    }).then((rows) => rows.map((r) => r.get({ plain: true }) as unknown as HrAdminEntryRow));
  }
  return cache.adminExpenseEntries;
}

function getTmsProcurements(cache: ScoringDataCache): Promise<TmsProcurementRecord[]> {
  if (!cache.tmsProcurements) cache.tmsProcurements = tmsProcurementStore.list();
  return cache.tmsProcurements;
}

function getHrTasks(cache: ScoringDataCache): Promise<GeneralTaskRecord[]> {
  if (!cache.hrTasks) cache.hrTasks = generalTaskStore.readAllBySourceModule('hr');
  return cache.hrTasks;
}

function getPaymentItems(cache: ScoringDataCache): Promise<PaymentQueueItem[]> {
  if (!cache.paymentItems) cache.paymentItems = getAllPaymentItems();
  return cache.paymentItems;
}

export type ScoreBand = 'red' | 'yellow' | 'green' | 'na';

export interface DrilldownItem { id: string; label: string; sublabel: string; href: string }

export interface BreakdownRow {
  label: string;
  value: string;
  // The actual records behind this metric — only populated on a MemberScore
  // row (per-person), never on the department-wide `breakdown` aggregate.
  // Lets the Person Performance Dashboard's "Pipeline contribution" tiles
  // click through to what they're counting, the same way its Tasks tiles
  // already do. Omitted (rather than []) when there's genuinely nothing
  // clickable to show for this metric.
  items?: DrilldownItem[];
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
  /** Display name — the Accounts payment queue records who paid by name, not
   *  username, so matching there needs this. Optional so existing callers
   *  that only have id/username keep compiling. */
  name?: string;
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

// Several record fields are typed as `string` but arrive as a Date at
// runtime: a store's toRecord passes 'nullable' fields straight through, and
// a DataTypes.DATE column therefore reaches here as a Date object
// (projects.closed_at, demo_schedule.scheduled_at), while PaymentQueueItem's
// paidAt is a string from some of its five sources and a Date from others.
// Calling .slice() on those throws — which is exactly what took the whole
// Department Health section down. Normalise rather than trust the type.
function dateOnly(value: unknown): string {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
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

    const wonProjects = projects.filter((p) => p.status === 'won');
    const lostProjects = projects.filter((p) => p.status === 'lost');
    const won = wonProjects.length;
    const lost = lostProjects.length;
    const created = quotations.length;
    const convertedQuotations = quotations.filter((q) => q.status === 'approved');
    const converted = convertedQuotations.length;

    let overdue = 0, tracked = 0;
    const onTrackQuotations: QuotationRecord[] = [];
    quotations.forEach((q) => {
      tracked += 1;
      if (needsFollowUp(q)) overdue += 1;
      else onTrackQuotations.push(q);
    });

    totalWon += won; totalLost += lost; totalQuotations += created; totalConverted += converted;
    totalOverdue += overdue; totalTracked += tracked;

    const components = [pct(won, won + lost), pct(converted, created), pct(tracked - overdue, tracked)].filter(
      (p): p is number => p !== null
    );
    const projectItem = (p: ProjectRecord, outcome: string): DrilldownItem => ({ id: p.id, label: p.client_name || p.company || `Project ${p.id}`, sublabel: outcome, href: `/projects/${p.id}` });
    const quotationItem = (q: QuotationRecord): DrilldownItem => ({ id: q.id, label: q.quotation_number, sublabel: q.status, href: `/my-quotations?highlight=${q.id}` });
    return {
      id: m.id,
      username: m.username,
      score: rounded(average(components)),
      metrics: [
        { label: 'Won / Lost deals', value: `${won} / ${lost}`, items: [...wonProjects.map((p) => projectItem(p, 'Won')), ...lostProjects.map((p) => projectItem(p, 'Lost'))] },
        { label: 'Quotations converted', value: `${converted} / ${created}`, items: quotations.map(quotationItem) },
        { label: 'Follow-ups on track', value: `${tracked - overdue} / ${tracked}`, items: onTrackQuotations.map(quotationItem) }
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
  'Everything the team owns in TMS — projects, tasks, BOM requests and procurement — as the share that is ON SCHEDULE: delivered by its end date, or still open and not yet due. Work delivered late, open past its date, or open with no end date at all counts against it. Projects still in planning with no end date set are listed but not scored — nothing has been committed to yet.';

// AI, AV, Robotics and R&D are the TMS departments, so their health is the
// whole TMS module and nothing outside it:
//
//   • TMS projects    managed or on the team of        → deadline
//   • TMS tasks       assigned to them                 → due_date
//   • BOM requests    they raised                      → required_date
//   • Procurement     they raised                      → expected_delivery_date
//
// Anyone working a project contributes: project membership counts, not just
// management, so a project's delivery lands on everyone on it.
//
// Pooled into ONE rate per person rather than four averaged rates, so someone
// with 12 projects and 1 BOM isn't scored as if those were equal bodies of work.
//
// Sales projects and demos were part of this and are deliberately gone: this
// is the TMS module's health, and that work belongs to the Sales pipeline.
interface TechWorkItem {
  id: string;
  label: string;
  /** '' when no end date has been set — see the undated rule in the scorer. */
  due: string;
  /** Completion date once finished; '' while still open. */
  doneOn: string;
  done: boolean;
  cancelled: boolean;
  /**
   * Created but never actually set up: a TMS project still in 'planning' with
   * no end date of any kind. Reported, but kept out of the score — see the
   * scorer for why.
   */
  unplanned?: boolean;
  href: string;
}

const BOM_DONE_STATUSES = new Set(['received', 'completed']);
const BOM_DEAD_STATUSES = new Set(['rejected']);

async function scoreTechTeam(team: TeamMember[], cache: ScoringDataCache): Promise<ScoreResult> {
  if (!team.length) return naResult(team, TECH_FORMULA);
  const [tmsProjects, tmsTasks, bomRequests, procurements] = await Promise.all([
    getTmsProjects(cache),
    getTmsTasks(cache),
    getTmsBomRequests(cache),
    getTmsProcurements(cache)
  ]);
  const today = new Date().toISOString().slice(0, 10);

  function itemsFor(memberId: string): TechWorkItem[] {
    const items: TechWorkItem[] = [];

    for (const p of tmsProjects) {
      // Managing it OR being on its team both count — delivery is the team's
      // result, so it lands on everyone working the project.
      if (p.project_manager_id !== memberId && !p.team_member_ids.includes(memberId)) continue;
      // deadline falls back to the estimate: the create route seeds one from
      // the other, but an older or oddly-edited project can carry only the estimate.
      // Undated work is KEPT (see the scoring rule below), not skipped.
      const due = dateOnly(p.deadline) || dateOnly(p.estimated_close_date);
      // 'planning' is the status every TMS project is CREATED with
      // (db/models/tmsProject.js defaults to it). A project still sitting
      // there with no end date of any kind has not been handed over or
      // committed to by this department — in practice these are sales
      // enquiries entered as projects and left alone, one per client, with no
      // manager and a single engineer attached. Counting them made the
      // engineer absorb someone else's unfinished data entry and dragged the
      // whole department's gauge down.
      // Narrow on purpose: the moment ANY end date is set it scores normally,
      // so real work cannot hide in planning, and a dated planning project
      // that blows its date still counts as overdue.
      const unplanned = p.status === 'planning' && !due;
      items.push({ id: `tmsp:${p.id}`, label: `${p.project_code} — ${p.name}`, due, doneOn: dateOnly(p.actual_close_date), done: p.status === 'completed', cancelled: p.status === 'cancelled', unplanned, href: `/tms/projects/${p.id}` });
    }

    for (const t of tmsTasks) {
      if (t.assignee_id !== memberId) continue;
      const due = dateOnly(t.due_date);
      items.push({ id: `tmst:${t.id}`, label: t.name, due, doneOn: dateOnly(t.completion_date), done: t.status === 'completed', cancelled: t.status === 'cancelled', href: `/tms/tasks/${t.id}` });
    }

    for (const b of bomRequests) {
      if (b.requested_by_id !== memberId) continue;
      const due = dateOnly(b.required_date);
      items.push({ id: `bom:${b.id}`, label: `${b.bom_request_code} — ${b.item_name}`, due, doneOn: dateOnly(b.received_at), done: BOM_DONE_STATUSES.has(b.status), cancelled: BOM_DEAD_STATUSES.has(b.status), href: `/tms/bom-requests/${b.id}` });
    }

    return items;
  }

  // Procurement rows carry no requester id — created_by is a resolved username
  // (see lib/tmsProcurementStore.ts) — so it is matched separately from the
  // id-keyed sources above rather than forcing both into one loop.
  function procurementItemsFor(username: string): TechWorkItem[] {
    const out: TechWorkItem[] = [];
    for (const pr of procurements) {
      if (pr.created_by !== username) continue;
      const due = dateOnly(pr.expected_delivery_date) || dateOnly(pr.required_date);
      out.push({ id: `proc:${pr.id}`, label: `${pr.procurement_code} — ${pr.item_name}`, due, doneOn: dateOnly(pr.actual_delivery_date), done: !!pr.actual_delivery_date, cancelled: false, href: `/tms/procurement/${pr.id}` });
    }
    return out;
  }

  let totalOnTime = 0, totalLate = 0, totalOverdueOpen = 0, totalUndated = 0, totalUnplanned = 0;

  const members: MemberScore[] = team.map((m) => {
    const items = [...itemsFor(m.id), ...procurementItemsFor(m.username)];

    let onTime = 0, late = 0, overdueOpen = 0, undated = 0, unplanned = 0;
    const onTimeItems: TechWorkItem[] = [], lateItems: TechWorkItem[] = [], overdueOpenItems: TechWorkItem[] = [], undatedItems: TechWorkItem[] = [], unplannedItems: TechWorkItem[] = [];
    items.forEach((i) => {
      if (i.cancelled) return;
      // Counted and shown, but never in the denominator: this is work that
      // has not been handed over yet, so it is not this team's delivery
      // record either way. It stays visible so it cannot quietly pile up.
      if (i.unplanned) { unplanned += 1; unplannedItems.push(i); return; }
      if (i.done) {
        // Delivered. With no end date on record there is nothing to have been
        // late against, so it counts as on time — the absence of a plan is a
        // planning failure, not a delivery one, and the undated bucket below
        // is where that gets charged.
        if (!i.due) { onTime += 1; onTimeItems.push(i); return; }
        // Finished without a recorded completion date can't be judged either
        // way, so it is left out rather than assumed on time or late.
        if (!i.doneOn) return;
        if (i.doneOn <= i.due) { onTime += 1; onTimeItems.push(i); }
        else { late += 1; lateItems.push(i); }
      } else if (!i.due) {
        // Still open with no committed end date. This used to be skipped,
        // which is why a department whose projects had no dates read N/A
        // however much work it was carrying. Open work nobody has committed
        // a date to is a real risk, so it counts against the score — and
        // setting the date is what moves it out of this bucket.
        undated += 1;
        undatedItems.push(i);
      } else if (i.due < today) {
        overdueOpen += 1;
        overdueOpenItems.push(i);
      } else {
        // Open, dated, and not yet due — ON SCHEDULE. This used to be
        // excluded as "nothing to judge yet", which left a department whose
        // work was all still running ahead of its dates reading N/A no matter
        // how much of it there was. A health gauge should say "on track"
        // there, not "no data": being inside your deadline is a real, good
        // state, and the late/overdue/undated buckets are what make it fall.
        onTime += 1;
        onTimeItems.push(i);
      }
    });

    totalOnTime += onTime; totalLate += late; totalOverdueOpen += overdueOpen; totalUndated += undated; totalUnplanned += unplanned;
    const denominator = onTime + late + overdueOpen + undated;
    const toDrilldown = (i: TechWorkItem): DrilldownItem => ({ id: i.id, label: i.label, sublabel: i.due ? `due ${i.due}` : 'no end date set', href: i.href });
    return {
      id: m.id,
      username: m.username,
      score: rounded(pct(onTime, denominator)),
      metrics: [
        { label: 'On schedule', value: `${onTime} / ${denominator}`, items: onTimeItems.map(toDrilldown) },
        { label: 'Delivered late', value: String(late), items: lateItems.map(toDrilldown) },
        { label: 'Open past due', value: String(overdueOpen), items: overdueOpenItems.map(toDrilldown) },
        { label: 'No end date set', value: String(undated), items: undatedItems.map(toDrilldown) },
        { label: 'In planning (not scored)', value: String(unplanned), items: unplannedItems.map(toDrilldown) }
      ]
    };
  });

  const breakdown: BreakdownRow[] = [
    { label: 'TMS work on schedule', value: `${totalOnTime} / ${totalOnTime + totalLate + totalOverdueOpen + totalUndated}` },
    { label: 'Open with no end date', value: String(totalUndated) }
  ];
  // Shown only when there are any, so a department that keeps its projects
  // set up properly does not carry a permanent zero row. These are excluded
  // from the ratio above, and naming them is what keeps the exclusion honest
  // rather than invisible.
  if (totalUnplanned > 0) {
    breakdown.push({ label: 'In planning, no end date (not scored)', value: String(totalUnplanned) });
  }
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
    const onTimeReqs: MarketingRequestRecord[] = [], lateReqs: MarketingRequestRecord[] = [], overdueOpenReqs: MarketingRequestRecord[] = [];
    withDeadline.forEach((r) => {
      if (r.status === 'completed') {
        if (r.updated_at.slice(0, 10) <= r.needed_by_date) { onTime += 1; onTimeReqs.push(r); }
        else { late += 1; lateReqs.push(r); }
      } else if (r.needed_by_date < today) {
        overdueOpen += 1;
        overdueOpenReqs.push(r);
      }
    });

    totalOnTime += onTime; totalLate += late; totalOverdueOpen += overdueOpen;
    // No per-request deep link exists yet (components/MarketingRequestsView.tsx
    // has no detail/highlight route the way /projects/:id or
    // /my-quotations?highlight=:id do) — links to the list page itself rather
    // than nothing, same reasoning as every other metric here.
    const requestItem = (r: MarketingRequestRecord): DrilldownItem => ({ id: r.id, label: r.title, sublabel: r.needed_by_date, href: '/marketing-requests' });
    return {
      id: m.id,
      username: m.username,
      score: rounded(pct(onTime, onTime + late + overdueOpen)),
      metrics: [
        { label: 'Delivered on time', value: `${onTime} / ${onTime + late + overdueOpen}`, items: onTimeReqs.map(requestItem) },
        { label: 'Delivered late', value: String(late), items: lateReqs.map(requestItem) },
        { label: 'Open past deadline', value: String(overdueOpen), items: overdueOpenReqs.map(requestItem) }
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
      const movedDcs = dcs.filter((d) => d.status !== 'prepared');
      const awaitingDcs = dcs.filter((d) => d.status === 'prepared');
      const moved = movedDcs.length;
      totalMoved += moved; totalDcs += dcs.length;
      // /backoffice reads ?dc=<id> to open that specific Delivery Challan
      // (mirrors its existing ?demoId= convention) — see components/
      // BackOfficeView.tsx.
      const dcItem = (d: (typeof dcs)[number]): DrilldownItem => ({ id: d.id, label: `${d.dc_number} — ${d.client_name}`, sublabel: d.status, href: `/backoffice?dc=${d.id}` });
      return {
        id: m.id,
        username: m.username,
        score: rounded(pct(moved, dcs.length)),
        metrics: [
          { label: 'DCs moved past preparation', value: `${moved} / ${dcs.length}`, items: movedDcs.map(dcItem) },
          { label: 'Still awaiting dispatch', value: String(dcs.length - moved), items: awaitingDcs.map(dcItem) }
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
const ADMINISTRATION_TARGET_DAYS = 2;

function daysBetween(fromIso: string, toIso: string): number {
  return (new Date(toIso).getTime() - new Date(fromIso).getTime()) / 86_400_000;
}

const ACCOUNTS_FORMULA =
  'The share of payment-queue items settled by their due date, averaged across the team. Items still unpaid past their due date count against everyone, since the queue is the team’s shared responsibility.';

// Accounts works the Accounts module — the payment queue aggregating
// Reimbursement, Admin Expenses, Office Operation Expenses, TMS BOM Requests
// and Travel Schedule. (This previously scored only BOM approval timing,
// which is one of five sources and not where most of the team's work is.)
//
// A paid item is credited to whoever paid it; `paidBy` on a queue item is a
// display NAME, not a username, so matching uses TeamMember.name.
//
// Unpaid-past-due items have no owner — nobody has acted on them yet — so
// they are charged to EVERY member's denominator. That is deliberate: a queue
// nobody touches would otherwise score 100% (or N/A) because only completed
// work is measurable, which is exactly the "fast when acting, never acting"
// blind spot a payment-queue metric must not have.
async function scoreAccountsTeam(team: TeamMember[], cache: ScoringDataCache): Promise<ScoreResult> {
  if (!team.length) return naResult(team, ACCOUNTS_FORMULA);
  const items = await getPaymentItems(cache);
  const today = new Date().toISOString().slice(0, 10);

  const backlog = items.filter((i) => i.status !== 'paid' && i.dueDate && i.dueDate < today);
  const paymentItem = (i: PaymentQueueItem): DrilldownItem => ({
    id: i.paymentId,
    label: `${i.sourceLabel} — ${i.payee}`,
    sublabel: i.dueDate ? `due ${i.dueDate}` : i.status,
    href: '/accounts/payments'
  });

  let totalOnTime = 0, totalLate = 0;

  const members: MemberScore[] = team.map((m) => {
    const paid = items.filter((i) => i.status === 'paid' && i.paidAt && i.paidBy && m.name && i.paidBy === m.name);
    const onTimeItems = paid.filter((i) => !i.dueDate || dateOnly(i.paidAt) <= i.dueDate);
    const lateItems = paid.filter((i) => i.dueDate && dateOnly(i.paidAt) > i.dueDate);
    totalOnTime += onTimeItems.length; totalLate += lateItems.length;
    return {
      id: m.id,
      username: m.username,
      score: rounded(pct(onTimeItems.length, onTimeItems.length + lateItems.length + backlog.length)),
      metrics: [
        { label: 'Paid by due date', value: `${onTimeItems.length} / ${onTimeItems.length + lateItems.length + backlog.length}`, items: onTimeItems.map(paymentItem) },
        { label: 'Paid late', value: String(lateItems.length), items: lateItems.map(paymentItem) },
        { label: 'Team backlog past due', value: String(backlog.length), items: backlog.map(paymentItem) }
      ]
    };
  });

  const breakdown: BreakdownRow[] = [
    { label: 'Paid by due date', value: `${totalOnTime} / ${totalOnTime + totalLate + backlog.length}` },
    { label: 'Unpaid past due', value: String(backlog.length) }
  ];
  return finalize(members, breakdown, ACCOUNTS_FORMULA);
}

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
    const bomItem = (r: TmsBomRequestRecord): DrilldownItem => ({ id: r.id, label: `${r.bom_request_code} — ${r.item_name}`, sublabel: r.project_name, href: `/tms/bom-requests/${r.id}` });
    return {
      id: m.id,
      username: m.username,
      score: rounded(pct(onTime.length, handled.length)),
      metrics: [
        { label: `Approved within ${ADMINISTRATION_TARGET_DAYS} days`, value: `${onTime.length} / ${handled.length}`, items: onTime.map(bomItem) },
        { label: 'Approvals handled', value: String(handled.length), items: handled.map(bomItem) }
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
// ---------------------------------------------------------------------------
// HR — everything the HR module puts on their desk.
const HR_APPROVAL_TARGET_DAYS = 3;

const HR_FORMULA =
  `HR’s own queue — reimbursement sheets they approved, admin-expense entries they approved, and their HR tasks — counted as delivered when handled within ${HR_APPROVAL_TARGET_DAYS} days or by the task deadline. Anything still awaiting an HR decision past that window counts against the whole team.`;

// HR is measured on the HR module's work, not on anything Sales- or TMS-side:
//
//   • Reimbursement sheets  they HR-reviewed    → within N days of manager approval
//   • Admin expense entries they approved       → within N days of submission
//   • HR tasks              assigned to them    → by deadline
//   • Pending HR approvals  nobody has actioned → charged to the whole team
//
// That last one is the point of including it. Only completed work carries a
// timestamp, so a queue nobody touches would otherwise score 100% or N/A —
// the "fast when acting, never acting" blind spot. A sheet sitting unapproved
// past the window is HR's failure collectively, so it lands on every member,
// exactly as the Accounts payment backlog does.
const HR_DONE_STATUSES = new Set(['completed', 'approved']);
const HR_CLOSED_STATUSES = new Set(['completed', 'approved', 'cancelled', 'rejected', 'declined']);

async function scoreHrTeam(team: TeamMember[], cache: ScoringDataCache): Promise<ScoreResult> {
  if (!team.length) return naResult(team, HR_FORMULA);
  const [tasks, sheets, adminEntries] = await Promise.all([
    getHrTasks(cache),
    getReimbursementSheets(cache),
    getAdminExpenseEntries(cache)
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const windowAgo = new Date(Date.now() - HR_APPROVAL_TARGET_DAYS * 86_400_000).toISOString().slice(0, 10);

  // Shared backlog: awaiting an HR decision for longer than the window.
  const pendingSheets = sheets.filter((r) => r.status === 'manager_approved' && dateOnly(r.manager_action_at) && dateOnly(r.manager_action_at) < windowAgo);
  const pendingAdmin = adminEntries.filter((r) => r.approval_status === 'pending' && dateOnly(r.created_at) < windowAgo);
  const backlog = pendingSheets.length + pendingAdmin.length;
  const backlogItems: DrilldownItem[] = [
    ...pendingSheets.map((r) => ({ id: `sheet:${r.id}`, label: `Reimbursement ${r.sheet_code || r.id}`, sublabel: 'awaiting HR approval', href: '/reimbursement' })),
    ...pendingAdmin.map((r) => ({ id: `adm:${r.id}`, label: `Admin expense ${r.id}`, sublabel: 'awaiting HR approval', href: '/admin-expenses' }))
  ];

  let totalOnTime = 0, totalLate = 0, totalOverdue = 0;

  const members: MemberScore[] = team.map((m) => {
    let onTime = 0, late = 0, overdueOpen = 0;
    const onTimeItems: DrilldownItem[] = [], lateItems: DrilldownItem[] = [], overdueItems: DrilldownItem[] = [];

    // 1. Reimbursement sheets this person HR-approved.
    sheets
      .filter((r) => r.hr_reviewer_id === m.id && r.hr_reviewed_at)
      .forEach((r) => {
        const from = dateOnly(r.manager_action_at) || dateOnly(r.created_at);
        const item: DrilldownItem = { id: `sheet:${r.id}`, label: `Reimbursement ${r.sheet_code || r.id}`, sublabel: `approved ${dateOnly(r.hr_reviewed_at)}`, href: '/reimbursement' };
        if (!from || daysBetween(from, dateOnly(r.hr_reviewed_at)) <= HR_APPROVAL_TARGET_DAYS) { onTime += 1; onTimeItems.push(item); }
        else { late += 1; lateItems.push(item); }
      });

    // 2. Admin expense entries this person approved.
    adminEntries
      .filter((r) => r.approved_by === m.id && r.approved_at)
      .forEach((r) => {
        const item: DrilldownItem = { id: `adm:${r.id}`, label: `Admin expense ${r.id}`, sublabel: `approved ${dateOnly(r.approved_at)}`, href: '/admin-expenses' };
        if (daysBetween(dateOnly(r.created_at), dateOnly(r.approved_at)) <= HR_APPROVAL_TARGET_DAYS) { onTime += 1; onTimeItems.push(item); }
        else { late += 1; lateItems.push(item); }
      });

    // 3. Their HR tasks. general_tasks has no completion timestamp, so
    //    updated_at stands in — the same compromise scoreMarketingTeam makes.
    tasks
      .filter((t) => t.assignee_id === m.id && t.deadline)
      .forEach((t) => {
        const item: DrilldownItem = { id: `task:${t.id}`, label: t.title, sublabel: `due ${t.deadline}`, href: `/my-tasks/${t.id}` };
        if (HR_DONE_STATUSES.has(t.status)) {
          if (dateOnly(t.updated_at) <= t.deadline) { onTime += 1; onTimeItems.push(item); }
          else { late += 1; lateItems.push(item); }
        } else if (!HR_CLOSED_STATUSES.has(t.status) && t.deadline < today) {
          overdueOpen += 1;
          overdueItems.push(item);
        }
      });

    totalOnTime += onTime; totalLate += late; totalOverdue += overdueOpen;
    const denominator = onTime + late + overdueOpen + backlog;
    return {
      id: m.id,
      username: m.username,
      score: rounded(pct(onTime, denominator)),
      metrics: [
        { label: 'Handled on time', value: `${onTime} / ${denominator}`, items: onTimeItems },
        { label: 'Handled late', value: String(late), items: lateItems },
        { label: 'Own work past deadline', value: String(overdueOpen), items: overdueItems },
        { label: 'Team awaiting HR approval', value: String(backlog), items: backlogItems }
      ]
    };
  });

  const breakdown: BreakdownRow[] = [
    { label: 'Handled on time', value: `${totalOnTime} / ${totalOnTime + totalLate + totalOverdue + backlog}` },
    { label: 'Awaiting HR approval', value: String(backlog) }
  ];
  return finalize(members, breakdown, HR_FORMULA);
}

const DEPARTMENT_SCORERS: Record<string, (team: TeamMember[], cache: ScoringDataCache) => Promise<ScoreResult>> = {
  // Each department is scored on the module it actually works in.
  Sales: scoreSalesTeam,
  'GEM - Sales': scoreSalesTeam,
  // TMS departments — scored on TMS tasks, not the Sales pipeline. R&D is a
  // TMS department too and was previously missing here entirely, so its gauge
  // always read N/A regardless of what the team had done.
  AV: scoreTechTeam,
  Robotics: scoreTechTeam,
  AI: scoreTechTeam,
  'R&D': scoreTechTeam,
  Marketing: scoreMarketingTeam,
  'Back Office': scoreBackOfficeTeam,
  // Accounts module (the payment queue), not BOM approval timing.
  Accounts: scoreAccountsTeam,
  Administration: scoreAdministrationTeam,
  // HR module's task engine. Both spellings are registered because the
  // seeded department is "HR" while this install's is "HR & Admin" — keying
  // off one name alone would silently leave the other unscored.
  HR: scoreHrTeam,
  'HR & Admin': scoreHrTeam
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
