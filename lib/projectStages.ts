// Pure helpers shared between server and client — no fs/blob imports.
import { ProjectStage } from './types';

export const FORWARD_STAGES: ProjectStage[] = [
  'cold_call',
  'catalogue_offered',
  'site_visit',
  'quotation',
  'demo',
  'customer_response',
  'negotiation',
  'po_received',
  'installation',
  'completed'
];

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

export function stageProgressPercent(stage: ProjectStage): number {
  if (stage === 'closed_lost') return 0;
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
