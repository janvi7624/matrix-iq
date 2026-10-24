import type { DemoRequestStatus } from './types';

// The demo approval chain, as one definition.
//
// Extracted from components/DemoScheduleView.tsx so the PARTNER portal can
// render the identical pipeline rather than a second, drifting copy. Pure
// data with no imports beyond the type, so either side can use it.
//
// Each named status IS a reached milestone once the record is at or past it,
// so "done" is simply "index <= current index".

export interface DemoStage {
  key: DemoRequestStatus;
  label: string;
}

export const DEMO_STAGES: DemoStage[] = [
  { key: 'pending_technical', label: 'Sales Request Submitted' },
  { key: 'pending_manager', label: 'Technical Approval' },
  { key: 'pending_backoffice', label: 'Manager Approval' },
  { key: 'dc_generated', label: 'Back Office — DC Generated' },
  { key: 'material_dispatched', label: 'Material Dispatched' },
  { key: 'demo_completed', label: 'Demo Completed' },
  { key: 'material_returned', label: 'Material Returned' },
  { key: 'dc_closed', label: 'DC Closed' }
];

// The same chain with everything physical removed: nothing is challaned,
// dispatched or returned for a demo given over a screen share, so the
// pipeline ends the moment the demo itself is done. Manager approval lands
// on 'ready_for_demo' instead of 'pending_backoffice'.
export const VIRTUAL_DEMO_STAGES: DemoStage[] = [
  { key: 'pending_technical', label: 'Sales Request Submitted' },
  { key: 'pending_manager', label: 'Technical Approval' },
  { key: 'ready_for_demo', label: 'Manager Approval' },
  { key: 'demo_completed', label: 'Demo Completed' }
];

export const DEMO_STATUS_LABEL: Record<DemoRequestStatus, string> = {
  draft: 'Draft',
  pending_technical: 'Pending Technical Approval',
  pending_manager: 'Pending Manager Approval',
  pending_backoffice: 'Pending Back Office',
  ready_for_demo: 'Ready — Virtual Demo',
  dc_generated: 'DC Generated',
  material_dispatched: 'Material Dispatched',
  demo_completed: 'Demo Completed',
  material_returned: 'Material Returned',
  dc_closed: 'DC Closed',
  cancelled: 'Cancelled'
};

export function stagesForMode(mode: string): DemoStage[] {
  return mode === 'virtual' ? VIRTUAL_DEMO_STAGES : DEMO_STAGES;
}

/**
 * How far along the chain a record is.
 *
 * -1 for a draft (submitted but not yet in the chain) and for 'cancelled',
 * which can happen from any status and records no stage — a cancelled demo
 * gets a plain badge instead of a fabricated stepper position.
 */
export function demoStageIndex(status: DemoRequestStatus, mode: string): number {
  if (status === 'draft' || status === 'cancelled') return -1;
  return stagesForMode(mode).findIndex((s) => s.key === status);
}
