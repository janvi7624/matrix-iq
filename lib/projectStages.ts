// Pure helpers shared between server and client — no fs/blob imports.
import { ProjectStage } from './types';

// The agreed sales pipeline (2026-10). Five stages, each with a fixed
// closing probability in lib/salesStageRules.ts — which is the point of the
// change: the old eight-stage list had its percentage derived from a
// stage's POSITION, so Cold Call read 13% instead of 10% and adding a stage
// silently re-graded the whole pipeline.
//
// Note the order: Demo / Qualified now sits BEFORE Quotation. Qualifying a
// deal (need, budget, decision-maker) precedes sending a formal quote,
// which is the reverse of the old list and is deliberate. The 'demo' value
// is kept rather than renamed because the whole demo-schedule module reads
// it; only its label changed.
//
// Everything else that exists in the enum is retired — Postgres cannot drop
// an enum value and real projects still carry them. Three of those
// (Catalogue Offered, Site Visit, Customer Response) have no equivalent
// here and hold about Rs 9.6 crore between them, so they are reported for
// re-triage rather than mapped by guesswork: see NEEDS_RETRIAGE_STAGES.
export const FORWARD_STAGES: ProjectStage[] = [
  'prospect',
  'demo',
  'quotation',
  'negotiation',
  'commit'
];

// What a project's stage may be SET to (dropdowns, PATCH/API validation) —
// the forward pipeline plus the one non-forward terminal value.
//
// 'cold_call' remains settable for as long as the value exists in the enum,
// so a client that has not yet picked up the rename keeps working; it is
// normalised to 'prospect' everywhere it matters
// (lib/salesStageRules.ts normalizeStage). The other retired values are not
// assignable: nothing should move INTO a stage that no longer exists.
export const ASSIGNABLE_STAGES: ProjectStage[] = [...FORWARD_STAGES, 'cold_call', 'closed_lost'];

// What each stage is CALLED. Two renames land here rather than in the
// database, because the stored value is load-bearing elsewhere while the
// label is not: 'demo' is read by the whole demo-schedule module, so it
// keeps its value and simply reads as "Demo / Qualified" — the agreed name
// — while 'cold_call' is being backfilled to 'prospect' and both spellings
// are labelled identically for as long as the old one exists.
export const STAGE_LABEL: Record<ProjectStage, string> = {
  prospect: 'Prospect',
  commit: 'Commit',
  cold_call: 'Prospect',
  catalogue_offered: 'Catalogue Offered',
  site_visit: 'Site Visit',
  quotation: 'Quotation',
  demo: 'Demo / Qualified',
  customer_response: 'Customer Response',
  negotiation: 'Negotiation',
  po_received: 'PO Received',
  installation: 'Installation',
  completed: 'Completed',
  closed_lost: 'Closed Lost'
};

// Retired stages that sat at or past the END of the old pipeline. For
// display they read as "at least as far as the pipeline goes" rather than
// the -1 that FORWARD_STAGES.indexOf would now return. 'po_received' joins
// them because winning is carried by status now, not by a stage.
const LEGACY_PAST_PIPELINE_STAGES: ProjectStage[] = ['po_received', 'installation', 'completed'];

// Retired stages that sat INSIDE the old pipeline, mapped to the step whose
// position they best match, purely so the stepper and the progress bar
// still render something truthful for the 39 projects still in them.
//
// This is display only. It is deliberately NOT used to assign a closing
// percentage — resolveClosingPercent reports those projects as unknown,
// because a position on a stepper is a guess and a forecast number is not
// the place for one.
const LEGACY_PIPELINE_POSITION: Partial<Record<ProjectStage, ProjectStage>> = {
  cold_call: 'prospect',
  catalogue_offered: 'prospect',
  site_visit: 'demo',
  customer_response: 'negotiation'
};

// Index into FORWARD_STAGES for stepper highlighting. A retired stage maps
// either past the last step (so every step shows done) or onto the step it
// best corresponds to, instead of the -1 that FORWARD_STAGES.indexOf would
// now return for it.
export function stageIndex(stage: ProjectStage): number {
  if (LEGACY_PAST_PIPELINE_STAGES.includes(stage)) return FORWARD_STAGES.length;
  const mapped = LEGACY_PIPELINE_POSITION[stage] ?? stage;
  return FORWARD_STAGES.indexOf(mapped);
}

/**
 * How far along the STEPPER a project is, as a percentage.
 *
 * Not the closing probability, and deliberately kept separate from it: this
 * is "4 of 5 steps done", whereas the forecast figure is an agreed business
 * number per stage (lib/salesStageRules.ts STAGE_CLOSING_PERCENT). Conflating
 * the two is what produced the old 13%-for-Cold-Call.
 */
export function stageProgressPercent(stage: ProjectStage): number {
  if (stage === 'closed_lost') return 0;
  if (LEGACY_PAST_PIPELINE_STAGES.includes(stage)) return 100;
  const idx = stageIndex(stage);
  if (idx === -1) return 0;
  return Math.round(((idx + 1) / FORWARD_STAGES.length) * 100);
}

// A sales person's own "Closing Probability %" (ProjectRecord.
// closing_probability_percent) read as a 5-step traffic-light gradient
// (low confidence -> red, high confidence -> the brightest green) rather
// than a plain badge — reuses the app's existing --mx-* tokens (--mx-won is
// deliberately brighter than --mx-success, see globals.css's own comment,
// which maps neatly onto "light-dark green" vs "light parrot green" here)
// instead of inventing new colors. Shared by the Project Dashboard column
// and the project detail Overview field so the same number always reads the
// same way everywhere it's shown.
export function closingProbabilityStyle(pct: number | ''): { background: string; color: string } | null {
  if (pct === '' || pct === null || pct === undefined) return null;
  if (pct <= 30) return { background: 'var(--mx-danger-subtle)', color: 'var(--mx-danger)' };
  if (pct <= 50) return { background: 'var(--mx-warning-subtle)', color: 'var(--mx-warning)' };
  if (pct <= 70) return { background: 'var(--mx-info-subtle)', color: 'var(--mx-info)' };
  if (pct <= 90) return { background: 'var(--mx-success-subtle)', color: 'var(--mx-success)' };
  return { background: 'var(--mx-won-subtle)', color: 'var(--mx-won)' };
}
