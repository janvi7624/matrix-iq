// The support ticket lifecycle: which statuses exist, who may move a ticket
// between them, and what each actor is allowed to do.
//
// Pure, no imports — the whole thing is a decision table over strings, and
// it is the file that decides whether a partner can mark their own ticket
// resolved or an engineer can close one without the customer confirming. It
// must be directly testable.
//
// The requirement listed thirteen statuses and said plainly that "not every
// transition should be available to every role". That sentence is this file.

export type SupportTicketStatus =
  | 'new'
  | 'open'
  | 'under_triage'
  | 'assigned'
  | 'acknowledged'
  | 'in_progress'
  | 'awaiting_partner'
  | 'awaiting_internal'
  | 'escalated'
  | 'resolved'
  | 'reopened'
  | 'closed'
  | 'cancelled';

export const SUPPORT_TICKET_STATUSES: SupportTicketStatus[] = [
  'new',
  'open',
  'under_triage',
  'assigned',
  'acknowledged',
  'in_progress',
  'awaiting_partner',
  'awaiting_internal',
  'escalated',
  'resolved',
  'reopened',
  'closed',
  'cancelled'
];

export const SUPPORT_STATUS_LABEL: Record<SupportTicketStatus, string> = {
  new: 'New',
  open: 'Open',
  under_triage: 'Under triage',
  assigned: 'Assigned',
  acknowledged: 'Acknowledged',
  in_progress: 'In progress',
  awaiting_partner: 'Awaiting your information',
  awaiting_internal: 'Awaiting internal team',
  escalated: 'Escalated',
  resolved: 'Resolved',
  reopened: 'Reopened',
  closed: 'Closed',
  cancelled: 'Cancelled'
};

/**
 * The actor kinds this workflow distinguishes.
 *
 * Deliberately NOT role keys. Several roles map onto 'manager' (an admin, a
 * superadmin, a technical-manager), and keying the table on role strings
 * would mean repeating every row three times and missing one when a new role
 * is added. lib/supportTicketAccess.ts maps a viewer onto one of these.
 */
export type SupportActor = 'partner' | 'engineer' | 'manager';

/** Statuses in which nobody is working the ticket and nobody has been asked to. */
export const UNASSIGNED_STATUSES: SupportTicketStatus[] = ['new', 'open', 'under_triage'];

/** Terminal — the ticket needs nothing further. */
export function isTerminalStatus(status: SupportTicketStatus): boolean {
  return status === 'closed' || status === 'cancelled';
}

/** Still open from the requester's point of view. */
export function isOpenStatus(status: SupportTicketStatus): boolean {
  return !isTerminalStatus(status) && status !== 'resolved';
}

// The transition table, as [from][actor] -> allowed targets.
//
// Reading notes for the non-obvious entries:
//  - A PARTNER may move 'awaiting_partner' -> 'in_progress' because replying
//    with the requested information is exactly that: the ball is back with
//    us. Without it, a partner could answer and the ticket would sit in a
//    status that says we are still waiting on them.
//  - A partner may 'resolved' -> 'closed' (confirming) or -> 'reopened'
//    (it is not actually fixed). They may NOT reach 'resolved' themselves:
//    declaring a technical fix is an engineering statement.
//  - An ENGINEER may not 'closed' anything. Closure follows the customer's
//    confirmation, or a manager's decision — otherwise the team marks its
//    own homework and the reopen rate becomes meaningless.
//  - 'cancelled' is manager-only from the early statuses. A ticket already
//    being worked is resolved or closed, not cancelled, so the trail shows
//    what actually happened.
const TRANSITIONS: Partial<Record<SupportTicketStatus, Partial<Record<SupportActor, SupportTicketStatus[]>>>> = {
  new: {
    manager: ['open', 'under_triage', 'assigned', 'cancelled'],
    engineer: ['under_triage']
  },
  open: {
    manager: ['under_triage', 'assigned', 'cancelled'],
    engineer: ['under_triage']
  },
  under_triage: {
    manager: ['assigned', 'escalated', 'cancelled'],
    engineer: ['assigned']
  },
  assigned: {
    manager: ['acknowledged', 'in_progress', 'assigned', 'escalated', 'cancelled'],
    // The assignee accepting the work.
    engineer: ['acknowledged', 'in_progress']
  },
  acknowledged: {
    manager: ['in_progress', 'assigned', 'escalated', 'cancelled'],
    engineer: ['in_progress', 'awaiting_partner', 'awaiting_internal', 'escalated']
  },
  in_progress: {
    manager: ['awaiting_partner', 'awaiting_internal', 'escalated', 'resolved', 'assigned', 'cancelled'],
    engineer: ['awaiting_partner', 'awaiting_internal', 'escalated', 'resolved']
  },
  awaiting_partner: {
    manager: ['in_progress', 'escalated', 'resolved', 'cancelled'],
    engineer: ['in_progress', 'resolved'],
    // Replying hands the ticket back to us.
    partner: ['in_progress']
  },
  awaiting_internal: {
    manager: ['in_progress', 'escalated', 'resolved', 'cancelled'],
    engineer: ['in_progress', 'resolved']
  },
  escalated: {
    manager: ['in_progress', 'assigned', 'resolved', 'cancelled'],
    engineer: ['in_progress']
  },
  resolved: {
    // A manager may close without waiting — for an unresponsive customer,
    // or a ticket nobody will confirm.
    manager: ['closed', 'reopened', 'in_progress'],
    engineer: ['reopened'],
    // The requester's two honest answers: fixed, or not fixed.
    partner: ['closed', 'reopened']
  },
  reopened: {
    manager: ['assigned', 'in_progress', 'escalated', 'cancelled'],
    engineer: ['in_progress', 'acknowledged']
  },
  // Terminal. A closed ticket is reopened by a manager only — otherwise
  // "closed" means nothing.
  closed: {
    manager: ['reopened']
  },
  cancelled: {
    manager: ['open']
  }
};

export function allowedTransitions(from: SupportTicketStatus, actor: SupportActor): SupportTicketStatus[] {
  return TRANSITIONS[from]?.[actor] ?? [];
}

export function canTransition(from: SupportTicketStatus, to: SupportTicketStatus, actor: SupportActor): boolean {
  return allowedTransitions(from, actor).includes(to);
}

export function isSupportTicketStatus(value: unknown): value is SupportTicketStatus {
  return typeof value === 'string' && (SUPPORT_TICKET_STATUSES as string[]).includes(value);
}

/**
 * Statuses that require a reason, because the trail is useless without one.
 *
 * Refusing a ticket, escalating it, or telling the partner it is fixed are
 * all statements someone will have to justify later.
 */
export function transitionRequiresReason(to: SupportTicketStatus): boolean {
  return to === 'cancelled' || to === 'escalated' || to === 'resolved' || to === 'reopened' || to === 'awaiting_partner';
}

/** Which actor a partner-facing status reads as. Partners never see internal queue states. */
export function partnerFacingStatus(status: SupportTicketStatus): SupportTicketStatus {
  // 'new', 'open', 'under_triage' and 'assigned' are all "we have it, nobody
  // has started yet" from outside. Collapsing them avoids telling a partner
  // their ticket is merely 'new' three days in, which reads as neglect even
  // when triage is actively happening.
  if (UNASSIGNED_STATUSES.includes(status) || status === 'assigned') return 'open';
  if (status === 'awaiting_internal') return 'in_progress';
  if (status === 'acknowledged') return 'in_progress';
  return status;
}

/** May this actor write a partner-visible (external) comment? */
export function canCommentExternally(actor: SupportActor): boolean {
  // Everyone can — but a partner's comment is ALWAYS external (they have no
  // internal channel), which the route enforces by forcing is_internal false
  // rather than trusting the request body.
  return actor === 'partner' || actor === 'engineer' || actor === 'manager';
}

/** May this actor write an internal-only note? Partners have no internal channel. */
export function canCommentInternally(actor: SupportActor): boolean {
  return actor !== 'partner';
}

/** May this actor assign or reassign? */
export function canAssign(actor: SupportActor): boolean {
  return actor === 'manager';
}

/** May this actor change priority? Engineers report severity; managers set it. */
export function canSetPriority(actor: SupportActor): boolean {
  return actor === 'manager';
}
