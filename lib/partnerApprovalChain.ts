// Partner onboarding approval chain — pure, no db imports, so the server
// gate and the client stepper read the same rules.
//
// Once a partner has uploaded every onboarding document, the set goes
// through three sign-offs in order: the Sales manager, then the Accounts
// manager, then the Administration manager. Only after the last one does
// partners.onboarded_at get stamped and the portal open. A rejection at any
// step sends the set back to the partner (the rejected documents must be
// replaced) and the chain restarts from Sales.
//
// Approvers are resolved from Department Master by department name, never
// hardcoded people — whoever manages Sales / Accounts / Administration is the
// approver for that step, so a change of manager needs no code change.

export const PARTNER_APPROVAL_STAGES = ['sales', 'accounts', 'admin'] as const;

export type PartnerApprovalStage = (typeof PARTNER_APPROVAL_STAGES)[number];

/** approval_stage column: a live stage, 'approved' once done, null while waiting on the partner. */
export type PartnerApprovalState = PartnerApprovalStage | 'approved' | null;

export const PARTNER_APPROVAL_DEPARTMENT: Record<PartnerApprovalStage, string> = {
  sales: 'Sales',
  accounts: 'Accounts',
  admin: 'Administration'
};

export const PARTNER_APPROVAL_LABEL: Record<PartnerApprovalStage, string> = {
  sales: 'Sales Manager',
  accounts: 'Accounts Manager',
  admin: 'Admin Manager'
};

export interface PartnerApprovalTrailEntry {
  stage: PartnerApprovalStage;
  decision: 'approved' | 'rejected';
  by_id: string;
  by_name: string;
  at: string;
  remarks: string;
}

export function isPartnerApprovalStage(value: unknown): value is PartnerApprovalStage {
  return typeof value === 'string' && (PARTNER_APPROVAL_STAGES as readonly string[]).includes(value);
}

/** The step after this one, or 'approved' when this was the last. */
export function nextApprovalStage(stage: PartnerApprovalStage): PartnerApprovalStage | 'approved' {
  const i = PARTNER_APPROVAL_STAGES.indexOf(stage);
  return PARTNER_APPROVAL_STAGES[i + 1] ?? 'approved';
}

/**
 * The latest decision per stage within the CURRENT round — entries before
 * the most recent rejection belong to an earlier round and no longer count.
 */
export function currentRoundDecisions(trail: PartnerApprovalTrailEntry[]): Partial<Record<PartnerApprovalStage, PartnerApprovalTrailEntry>> {
  let lastReject = -1;
  trail.forEach((e, i) => {
    if (e.decision === 'rejected') lastReject = i;
  });
  const out: Partial<Record<PartnerApprovalStage, PartnerApprovalTrailEntry>> = {};
  trail.slice(lastReject + 1).forEach((e) => {
    if (e.decision === 'approved') out[e.stage] = e;
  });
  return out;
}

/** The last rejection, if the set is currently back with the partner because of one. */
export function lastRejection(trail: PartnerApprovalTrailEntry[]): PartnerApprovalTrailEntry | null {
  for (let i = trail.length - 1; i >= 0; i--) {
    if (trail[i].decision === 'rejected') return trail[i];
    if (trail[i].decision === 'approved') return null;
  }
  return null;
}

/** The line the partner and staff see describing where the approval is. */
export function approvalStatusLine(state: PartnerApprovalState): string {
  if (state === 'approved') return 'All approvals complete — the partner has full portal access.';
  if (!state) return 'Waiting for the partner to upload every document.';
  return `Waiting for approval from the ${PARTNER_APPROVAL_LABEL[state]}.`;
}
