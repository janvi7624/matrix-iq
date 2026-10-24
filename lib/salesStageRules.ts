// The sales pipeline's forecasting rules: what a stage is worth, what a stage
// demands before a deal may enter it, and when a deal has gone quiet.
//
// Pure — no DB, no fs, no React — so the server, the dashboard and the
// exporters all read the same numbers from one place. That is the whole point:
// the complaint this module answers is that Closing % was typed in by hand, so
// the same deal could be 25% to one person and 100% to another, and a
// forecast built on it meant nothing.
//
// Stage vocabulary lives in lib/types.ts (PROJECT_STAGES) and the pipeline's
// display order in lib/projectStages.ts. This file deliberately owns only the
// MONEY and the GATES.

import { ProjectStage, ProjectStatus } from './types';

// ---------------------------------------------------------------- the stages

/**
 * The five stages a live deal moves through, in order.
 *
 * Won and Lost are deliberately NOT here. They are outcomes, and this app
 * already records them on `status` ('won' | 'lost'), which predates this
 * change and is what the Close Project buttons, closed_at and the 90-day
 * auto-hide all key off. Adding them as stages too would create a second
 * source of truth for the same fact, and the data already shows what that
 * costs: there are projects sitting in an early stage with status 'won'.
 * resolveClosingPercent reads status FIRST for exactly this reason.
 */
export const PIPELINE_STAGES: ProjectStage[] = [
  'prospect',
  'demo',
  'quotation',
  'negotiation',
  'commit'
];

/**
 * The standard probability for each pipeline stage, as a percentage.
 *
 * These are the agreed figures, not a computed curve: the old
 * stageProgressPercent() derived a percentage from a stage's POSITION
 * ((index+1)/8), which is why Cold Call used to read 13% rather than 10% and
 * why inserting a stage silently re-graded the whole pipeline.
 */
export const STAGE_CLOSING_PERCENT: Partial<Record<ProjectStage, number>> = {
  prospect: 10,
  demo: 30,
  quotation: 50,
  negotiation: 70,
  commit: 90
};

/** 100% once the PO is in; 0% once the deal is lost. */
export const WON_PERCENT = 100;
export const LOST_PERCENT = 0;

/**
 * Stages that are no longer part of the pipeline but still exist on real
 * projects, because Postgres cannot drop an enum value and these rows are
 * live business data.
 *
 * - cold_call is the pre-migration spelling of prospect. Both are accepted
 *   for as long as the value survives in the enum, so this module behaves
 *   identically either side of the backfill — that is what lets the data
 *   migration and the code deploy happen in any order.
 * - catalogue_offered / site_visit / customer_response were real pipeline
 *   steps with no equivalent in the new five. They are NOT silently mapped:
 *   see NEEDS_RETRIAGE_STAGES.
 * - po_received is the old way of saying Won; status carries that now.
 * - installation / completed were retired by an earlier management decision.
 */
export const RETIRED_STAGES: ProjectStage[] = [
  'cold_call',
  'catalogue_offered',
  'site_visit',
  'customer_response',
  'po_received',
  'installation',
  'completed'
];

/**
 * Retired stages whose projects a human has to re-grade, because guessing
 * would be worse than admitting we do not know.
 *
 * cold_call is absent: it maps to prospect exactly, so it needs no judgement.
 * po_received, installation and completed are absent too — they are all
 * finished deals, and status already says so.
 *
 * A project in one of these has NO closing percentage (null, not zero). Zero
 * would quietly understate the forecast by the full value of the deal and
 * look like a legitimate answer; null is visible and demands a decision.
 */
export const NEEDS_RETRIAGE_STAGES: ProjectStage[] = [
  'catalogue_offered',
  'site_visit',
  'customer_response'
];

export function stageNeedsRetriage(stage: ProjectStage): boolean {
  return NEEDS_RETRIAGE_STAGES.includes(stage);
}

/** cold_call and prospect are the same stage under two spellings. */
export function normalizeStage(stage: ProjectStage): ProjectStage {
  return stage === 'cold_call' ? 'prospect' : stage;
}

// ------------------------------------------------------- the closing percent

export interface ClosingPercentInput {
  stage: ProjectStage;
  status: ProjectStatus;
  /** An admin's manual figure, with a reason. Null when not overridden. */
  closing_percent_override?: number | null;
}

export type ClosingPercentSource = 'status' | 'override' | 'stage' | 'unknown';

export interface ClosingPercentResult {
  /** Null means genuinely unknown — never treat it as zero. */
  percent: number | null;
  source: ClosingPercentSource;
}

/**
 * The one place a Closing % is decided. Every display, calculation and export
 * must come through here, or they will disagree with each other — which is
 * the original complaint in a new costume.
 *
 * Precedence, and why:
 *
 *  1. status won/lost. A received purchase order is a fact, not a forecast, so
 *     it outranks even an admin override: there is no legitimate reason to
 *     record an 80% chance of winning a deal that is already won.
 *  2. an admin override. Deliberately above the stage figure — that is what an
 *     override is for — but note that changing stage CLEARS it (see
 *     clearOverrideOnStageChange), so it can never quietly outlive the
 *     judgement it was based on.
 *  3. the stage's standard percentage.
 *  4. nothing. A retired stage awaiting re-triage, which reports as null.
 */
export function resolveClosingPercent(project: ClosingPercentInput): ClosingPercentResult {
  if (project.status === 'won') return { percent: WON_PERCENT, source: 'status' };
  if (project.status === 'lost' || project.stage === 'closed_lost') {
    return { percent: LOST_PERCENT, source: 'status' };
  }

  const override = project.closing_percent_override;
  if (typeof override === 'number' && Number.isFinite(override)) {
    return { percent: clampPercent(override), source: 'override' };
  }

  const standard = STAGE_CLOSING_PERCENT[normalizeStage(project.stage)];
  if (typeof standard === 'number') return { percent: standard, source: 'stage' };

  return { percent: null, source: 'unknown' };
}

export function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Whether a stage change should discard an existing admin override.
 *
 * It always should: an override is a judgement about a deal AT a point in the
 * pipeline ("this Negotiation is better than 70%"), so carrying it into the
 * next stage would assert a judgement nobody made. Moving the stage therefore
 * restores the standard figure, and an admin who still disagrees overrides
 * again — with a fresh reason, which is the auditable part.
 */
export function clearOverrideOnStageChange(previous: ProjectStage, next: ProjectStage): boolean {
  return normalizeStage(previous) !== normalizeStage(next);
}

// -------------------------------------------------------------- the forecast

/** approx_price arrives from pg as a string for DECIMAL columns. */
export function priceOf(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Approx. Price x probability — the only number in the pipeline that is
 * comparable across stages.
 *
 * Null when either half is unknown, rather than 0: a deal with no price and a
 * deal worth nothing are different facts, and 48 active projects currently
 * have no price at all. Summing nulls as zeroes would report a confident,
 * wrong forecast.
 */
export function weightedValue(price: unknown, percent: number | null): number | null {
  const amount = priceOf(price);
  if (amount === null || percent === null) return null;
  return (amount * percent) / 100;
}

/**
 * Whether a deal belongs in the weighted OPEN pipeline.
 *
 * Won and lost deals are excluded: won revenue is actual, not forecast, and
 * adding a closed deal at 100% to a forecast double-counts it against the
 * revenue it already produced. On-hold deals are excluded too — they are not
 * closed, but a forecast that counts a parked deal as live is the kind of
 * optimism this change exists to remove. They are reported separately rather
 * than dropped, so the pipeline still adds up.
 */
export function countsTowardForecast(status: ProjectStatus): boolean {
  return status === 'active';
}

// ------------------------------------------------------------ time in stage

/**
 * Whole days between two ISO dates (YYYY-MM-DD), UTC-anchored so a timezone
 * offset can never make it off-by-one. Both the dashboard column and the
 * staleness test use this, so they can never disagree about what "14 days"
 * means.
 */
export function daysBetween(from: string, to: string): number | null {
  if (!isIsoDate(from) || !isIsoDate(to)) return null;
  const a = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)));
  const b = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)));
  return Math.round((b - a) / 86_400_000);
}

export function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * How long the deal has sat where it is.
 *
 * `enteredStageOn` is the date of the most recent "Stage moved to ..." event
 * in project_timeline_events, or the project's creation date when it has never
 * moved — a project in its first stage has still been there for a measurable
 * time, and reporting that as unknown would hide the oldest untouched deals.
 */
export function daysInStage(enteredStageOn: string | null, today: string): number | null {
  if (!enteredStageOn) return null;
  const days = daysBetween(enteredStageOn, today);
  return days === null ? null : Math.max(0, days);
}

/** A deal nobody has touched for this long is flagged. */
export const STALE_AFTER_DAYS = 14;

/**
 * No meaningful update for STALE_AFTER_DAYS or more.
 *
 * "Meaningful" is the caller's problem, and deliberately so: the timeline
 * carries automated entries as well as human ones, and counting a background
 * write as activity would mean a deal could look alive while nobody had
 * looked at it for a month. The caller passes the last HUMAN activity date.
 *
 * Closed deals are never stale — there is nothing left to chase.
 */
export function isStale(
  lastActivityOn: string | null,
  today: string,
  status: ProjectStatus
): boolean {
  if (status === 'won' || status === 'lost') return false;
  if (!lastActivityOn) return false;
  const days = daysBetween(lastActivityOn, today);
  return days !== null && days >= STALE_AFTER_DAYS;
}

/**
 * A Commit deal whose PO was expected before today and has not arrived.
 *
 * Commit means "verbally confirmed, PO expected within 30 days". Once that
 * date passes with the deal still open, the 90% is the least trustworthy
 * number on the dashboard, so it is flagged rather than quietly carried.
 *
 * A Commit deal with NO expected PO date is not overdue — it is a data-quality
 * problem, which commitMissingPoDate reports separately. Treating missing as
 * overdue would bury the real ones.
 */
export function isOverdueCommit(
  stage: ProjectStage,
  status: ProjectStatus,
  expectedPoDate: string | null,
  today: string
): boolean {
  if (normalizeStage(stage) !== 'commit' || !countsTowardForecast(status)) return false;
  if (!isIsoDate(expectedPoDate)) return false;
  const days = daysBetween(expectedPoDate, today);
  return days !== null && days > 0;
}

export function commitMissingPoDate(
  stage: ProjectStage,
  status: ProjectStatus,
  expectedPoDate: string | null
): boolean {
  return normalizeStage(stage) === 'commit' && countsTowardForecast(status) && !isIsoDate(expectedPoDate);
}

// ------------------------------------------------------------- stage gates

export const LOST_REASONS = ['price', 'competitor', 'budget', 'timing', 'no_response'] as const;
export type LostReason = (typeof LOST_REASONS)[number];

export const LOST_REASON_LABEL: Record<LostReason, string> = {
  price: 'Price',
  competitor: 'Competitor',
  budget: 'Budget',
  timing: 'Timing',
  no_response: 'No Response'
};

export function isLostReason(value: unknown): value is LostReason {
  return typeof value === 'string' && (LOST_REASONS as readonly string[]).includes(value);
}

/** The project fields a stage gate can demand, and how each reads to a human. */
export const GATE_FIELD_LABEL: Record<string, string> = {
  approx_price: 'Approx. Price',
  quote_value: 'Quote Value',
  quotation_date: 'Quotation Date',
  expected_closing_date: 'Expected Closing Date',
  expected_po_date: 'Expected PO Date',
  confirmed_by_contact: 'Customer contact who confirmed',
  po_number: 'PO Number',
  po_value: 'PO Value',
  po_date: 'PO Date',
  lost_reason: 'Lost Reason',
  project_name: 'Project Name',
  company: 'Company Name',
  project_brief: 'Project Brief'
};

/**
 * What each stage requires before a deal may ENTER it.
 *
 * Note "enter". These are transition gates, not row validation, and the
 * difference matters: 100 active projects have no expected closing date and 48
 * have no price. Validating on every save would lock those people out of
 * editing a phone number on a deal that predates the rule, which is both
 * useless and the fastest way to get a feature switched off. A legacy record
 * stays readable and correctable; it only has to satisfy the gate on the way
 * forward.
 *
 * Approx. Price appears from Quotation onward, per the brief.
 */
export const STAGE_GATES: Partial<Record<ProjectStage, string[]>> = {
  quotation: ['approx_price', 'quote_value', 'quotation_date'],
  negotiation: ['approx_price', 'expected_closing_date'],
  commit: ['approx_price', 'expected_po_date', 'confirmed_by_contact']
};

/**
 * Won and Lost are reached through status, so their gates key off that.
 *
 * Won's gate is deliberately the handover checklist, not a pipeline-progress
 * check: project_name/company so the deal has a name anyone can find it by,
 * project_brief so the technical team taking it over knows what it is
 * without reverse-engineering it from Approx. Price and a quotation total,
 * and the po_* fields so the deal that funds the work is on record. (Whether
 * a *quotation* exists is checked separately in the PATCH route — it is a
 * row-existence question, not a blank-field one, so it cannot live in this
 * field-blankness gate the way these can.)
 */
export const STATUS_GATES: Partial<Record<ProjectStatus, string[]>> = {
  won: ['project_name', 'company', 'project_brief', 'po_number', 'po_value', 'po_date'],
  lost: ['lost_reason']
};

function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (typeof value === 'number') return !Number.isFinite(value);
  return false;
}

export interface GateFailure {
  field: string;
  label: string;
  message: string;
}

/**
 * The fields missing before this deal may enter `nextStage` (and/or
 * `nextStatus`), merged from the stage and status gates.
 *
 * `values` is the project AS IT WOULD BE after the change — the caller merges
 * the patch over the existing row first, so a transition that supplies the
 * missing field in the same request passes. Requiring two round trips to
 * move a stage would be its own kind of broken.
 */
export function stageGateFailures(
  nextStage: ProjectStage,
  nextStatus: ProjectStatus,
  values: Record<string, unknown>
): GateFailure[] {
  // A deal that is CLOSING answers only to its outcome's gate, never to the
  // gate of the stage it happens to be sitting in.
  //
  // Otherwise losing a deal in Negotiation would demand an expected closing
  // date for a deal that is never going to close — forcing someone to invent
  // a date in order to record a loss, which is both a lie and the reason dead
  // deals sit open for months instead. Winning is the same: a PO arriving is
  // not the moment to insist on the forward-pipeline paperwork.
  const closing = nextStatus === 'won' || nextStatus === 'lost' || nextStage === 'closed_lost';

  const required = new Set<string>(
    closing ? (STATUS_GATES[nextStatus] ?? []) : (STAGE_GATES[normalizeStage(nextStage)] ?? [])
  );

  // Lost is reachable by stage as well as by status, and the reason is
  // required either way.
  if (nextStage === 'closed_lost') required.add('lost_reason');

  const failures: GateFailure[] = [];
  for (const field of required) {
    const value = values[field];
    if (isBlank(value)) {
      failures.push({
        field,
        label: GATE_FIELD_LABEL[field] ?? field,
        message: `${GATE_FIELD_LABEL[field] ?? field} is required before this deal can move to ${stageGateName(nextStage, nextStatus)}.`
      });
      continue;
    }
    if (field === 'lost_reason' && !isLostReason(value)) {
      failures.push({
        field,
        label: GATE_FIELD_LABEL[field],
        message: `Lost Reason must be one of ${LOST_REASONS.map((r) => LOST_REASON_LABEL[r]).join(', ')}.`
      });
    }
    if ((field === 'quote_value' || field === 'po_value') && priceOf(value) === null) {
      failures.push({
        field,
        label: GATE_FIELD_LABEL[field],
        message: `${GATE_FIELD_LABEL[field]} must be a number.`
      });
    }
  }
  return failures;
}

function stageGateName(stage: ProjectStage, status: ProjectStatus): string {
  if (status === 'won') return 'Won';
  if (status === 'lost' || stage === 'closed_lost') return 'Lost';
  return STAGE_GATE_NAME[normalizeStage(stage)] ?? String(stage).replace(/_/g, ' ');
}

const STAGE_GATE_NAME: Partial<Record<ProjectStage, string>> = {
  prospect: 'Prospect',
  demo: 'Demo / Qualified',
  quotation: 'Quotation',
  negotiation: 'Negotiation',
  commit: 'Commit'
};
