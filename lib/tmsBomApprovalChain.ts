// The BOM/BOQ request approval chain, as data.
//
// One place that answers "what are the steps, which one is this request
// sitting on, who cleared the earlier ones" — so the detail page, the list
// and the notification copy can never disagree about where a request is.
//
// Pure: no db/fs imports, same as lib/tmsLabels.ts, so 'use client' views
// can render the trail without a round trip.
//
// The chain is: Requester -> their own Department Manager -> Management
// (Administration) -> [Finance, only when one is configured] -> Accounts
// payment -> Requester confirms receipt.
//
// The Finance step is CONDITIONAL on AppConfig.bomFinanceApproverId being
// set. With nobody configured there is no such person, and treating it as a
// mandatory step is what made a request stall silently after Management
// approval: admin-approve notified only the configured finance approver (so
// nobody), and Accounts could only pay from 'finance_approved'. An optional
// step that is skipped when it has no owner keeps the chain short for an org
// that doesn't use it, without deleting it for one that does.

import { TmsBomRequestStatus } from './types';

export type BomStageKey = 'request' | 'department_manager' | 'management' | 'finance' | 'payment' | 'received';

/** done = cleared; current = waiting on this step now; upcoming = not reached. */
export type BomStageState = 'done' | 'current' | 'upcoming' | 'rejected' | 'skipped';

export interface BomStage {
  key: BomStageKey;
  /** Step name. */
  label: string;
  /** Who owns the step, in words — "Robotics manager", "Accounts". */
  owner: string;
  state: BomStageState;
  /** Who actually did it, once done. */
  actorName: string;
  /** ISO timestamp of the action, once done. */
  at: string;
}

/** Just the fields the trail reads — so a test needn't build a whole record. */
export interface BomChainInput {
  status: TmsBomRequestStatus;
  department_name?: string;
  requested_by_name?: string;
  created_at?: string;
  reviewed_by_name?: string;
  reviewed_at?: string;
  admin_reviewed_by_name?: string;
  admin_reviewed_at?: string;
  finance_reviewed_by_name?: string;
  finance_reviewed_at?: string;
  payment_marked_by_name?: string;
  payment_marked_at?: string;
  received_by_name?: string;
  received_at?: string;
}

/**
 * How many steps of the chain each status has COMPLETED — so the step at
 * that index is the one still outstanding. 'submitted' means the request
 * itself is done (1) and the department manager's approval is what is being
 * waited on, not that the manager has already approved.
 */
const REACHED: Record<TmsBomRequestStatus, number> = {
  draft: 0,
  submitted: 1,
  under_review: 1,
  approved: 2,
  admin_approved: 3,
  finance_approved: 4,
  payment_done: 5,
  received: 6,
  completed: 6,
  // Off-chain: handled before the walk below.
  rejected: -1,
  sent_for_procurement: -1
};

const ORDER: BomStageKey[] = ['request', 'department_manager', 'management', 'finance', 'payment', 'received'];
const INDEX: Record<BomStageKey, number> = { request: 0, department_manager: 1, management: 2, finance: 3, payment: 4, received: 5 };

/**
 * Every step of the chain with its state, in order.
 *
 * `financeStageEnabled` mirrors "a Finance Approver is configured in
 * Application Settings". When false the Finance step is reported as
 * 'skipped' rather than hidden — a reader who has heard the chain described
 * with a finance step should be able to see that it was passed over, not
 * wonder whether the page is missing something.
 */
export function bomApprovalTrail(record: BomChainInput, financeStageEnabled: boolean): BomStage[] {
  const departmentOwner = record.department_name ? `${record.department_name} manager` : 'Department manager';

  const base: Omit<BomStage, 'state'>[] = [
    { key: 'request', label: 'Requested', owner: record.requested_by_name || 'Requester', actorName: record.requested_by_name || '', at: record.created_at || '' },
    { key: 'department_manager', label: 'Department Manager approval', owner: departmentOwner, actorName: record.reviewed_by_name || '', at: record.reviewed_at || '' },
    { key: 'management', label: 'Management approval', owner: 'Administration', actorName: record.admin_reviewed_by_name || '', at: record.admin_reviewed_at || '' },
    { key: 'finance', label: 'Finance approval', owner: 'Finance Approver', actorName: record.finance_reviewed_by_name || '', at: record.finance_reviewed_at || '' },
    { key: 'payment', label: 'Payment', owner: 'Accounts', actorName: record.payment_marked_by_name || '', at: record.payment_marked_at || '' },
    { key: 'received', label: 'Material received', owner: record.requested_by_name || 'Requester', actorName: record.received_by_name || '', at: record.received_at || '' }
  ];

  // A rejection stops the chain where it happened: everything already
  // stamped stays 'done', the step that rejected is 'rejected', and nothing
  // after it is pending anybody. Which step rejected is read from the
  // stamps, because the status is just 'rejected' either way.
  if (record.status === 'rejected') {
    const rejectedAt = record.admin_reviewed_at || record.finance_reviewed_at ? (record.finance_reviewed_at ? 'finance' : 'management') : 'department_manager';
    return base.map((stage) => {
      if (stage.key === 'request') return { ...stage, state: 'done' as BomStageState };
      if (stage.key === rejectedAt) return { ...stage, state: 'rejected' as BomStageState };
      if (stage.at) return { ...stage, state: 'done' as BomStageState };
      return { ...stage, state: 'upcoming' as BomStageState };
    });
  }

  // Sent to Procurement leaves the payment chain altogether — the item is
  // being bought through Procurement instead, so the remaining approval
  // steps are not pending anyone and must not read as overdue.
  if (record.status === 'sent_for_procurement') {
    return base.map((stage) => ({
      ...stage,
      state: (stage.at ? 'done' : stage.key === 'request' ? 'done' : 'skipped') as BomStageState
    }));
  }

  const reached = REACHED[record.status] ?? 0;

  return base.map((stage) => {
    if (stage.key === 'finance' && !financeStageEnabled && !stage.at) {
      return { ...stage, state: 'skipped' as BomStageState };
    }
    const position = INDEX[stage.key];
    // 'request' is cleared the moment it leaves draft; a draft is still
    // sitting on its author.
    if (stage.key === 'request') {
      return { ...stage, state: (record.status === 'draft' ? 'current' : 'done') as BomStageState };
    }
    if (position < reached) return { ...stage, state: 'done' as BomStageState };
    if (position === reached) return { ...stage, state: 'current' as BomStageState };
    return { ...stage, state: 'upcoming' as BomStageState };
  }).map((stage, _i, all) => {
    // Skipping Finance hands its turn to Payment, otherwise a request
    // waiting on Accounts would show nothing as current at all.
    if (stage.key === 'payment' && stage.state === 'upcoming') {
      const finance = all.find((s) => s.key === 'finance');
      if (finance?.state === 'skipped' && record.status === 'admin_approved') {
        return { ...stage, state: 'current' as BomStageState };
      }
    }
    return stage;
  });
}

/**
 * The one-line "who is holding this up" summary, derived from the trail so
 * it cannot contradict it.
 *
 * Replaces the fixed-string version in lib/tmsLabels.ts, which named Finance
 * as the next step even when no Finance Approver existed to take it.
 */
export function bomPendingWithLabel(record: BomChainInput, financeStageEnabled: boolean): string {
  if (record.status === 'rejected') return 'Rejected';
  if (record.status === 'sent_for_procurement') return 'With Procurement';
  if (record.status === 'received' || record.status === 'completed') return 'Complete — nothing pending';
  const trail = bomApprovalTrail(record, financeStageEnabled);
  const current = trail.find((s) => s.state === 'current');
  if (!current) return '';
  if (current.key === 'request') return 'Not yet submitted';
  return `Pending: ${current.label} — ${current.owner}`;
}

/**
 * "Is Accounts the one holding this?" — the single predicate for it.
 *
 * Three places asked this and only two of them can be right at once: the
 * mark-payment route, the Accounts Payment Queue's listing, and that queue's
 * own pay action. All three required 'finance_approved' exactly, so with no
 * Finance Approver configured a management-approved request never appeared
 * in Accounts' queue and could not be paid from the detail page either.
 */
export function isBomAwaitingPayment(status: TmsBomRequestStatus, financeStageEnabled: boolean): boolean {
  if (status === 'finance_approved') return true;
  return !financeStageEnabled && status === 'admin_approved';
}

export { ORDER as BOM_STAGE_ORDER };
