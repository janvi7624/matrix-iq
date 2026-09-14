// Pure helpers shared between server and client — no fs/blob imports.
import { ProjectStage } from './types';

// Management decision (2026-09): Installation and Completed are no longer
// Project Progress stages — PO Received is now the final stage. They stay in
// the ProjectStage type/DB enum (Postgres can't drop enum values, and a
// handful of existing projects still carry them — see ASSIGNABLE_STAGES and
// the legacy-stage handling below), they're just no longer part of the
// forward pipeline or assignable to any project going forward.
export const FORWARD_STAGES: ProjectStage[] = [
  'cold_call',
  'catalogue_offered',
  'site_visit',
  'quotation',
  'demo',
  'customer_response',
  'negotiation',
  'po_received'
];

// What a project's stage may be SET to (dropdowns, PATCH/API validation) —
// the forward pipeline plus the one non-forward terminal value. Deliberately
// excludes 'installation'/'completed'.
export const ASSIGNABLE_STAGES: ProjectStage[] = [...FORWARD_STAGES, 'closed_lost'];

export const STAGE_LABEL: Record<ProjectStage, string> = {
  cold_call: 'Cold Call',
  catalogue_offered: 'Catalogue Offered',
  site_visit: 'Site Visit',
  quotation: 'Quotation',
  demo: 'Demo',
  customer_response: 'Customer Response',
  negotiation: 'Negotiation',
  po_received: 'PO Received',
  installation: 'Installation',
  completed: 'Completed',
  closed_lost: 'Closed Lost'
};

// A handful of existing projects still carry the retired 'installation'/
// 'completed' stage values (see the migration audit) — they used to sit past
// po_received in the old 10-stage order, so for display purposes they read
// as "at least as far as the pipeline goes" rather than an unknown/0 stage.
const LEGACY_PAST_PIPELINE_STAGES: ProjectStage[] = ['installation', 'completed'];

// Index into FORWARD_STAGES for stepper highlighting — a legacy stage maps
// past the last step (so every step shows done) instead of the -1 that
// FORWARD_STAGES.indexOf would give now that they're not in the array.
export function stageIndex(stage: ProjectStage): number {
  if (LEGACY_PAST_PIPELINE_STAGES.includes(stage)) return FORWARD_STAGES.length;
  return FORWARD_STAGES.indexOf(stage);
}

export function stageProgressPercent(stage: ProjectStage): number {
  if (stage === 'closed_lost') return 0;
  if (LEGACY_PAST_PIPELINE_STAGES.includes(stage)) return 100;
  const idx = FORWARD_STAGES.indexOf(stage);
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
