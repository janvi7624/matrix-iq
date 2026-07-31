// Pure helpers shared between server and client — no fs/blob imports.
import { ProjectStage } from './types';

export const FORWARD_STAGES: ProjectStage[] = [
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
