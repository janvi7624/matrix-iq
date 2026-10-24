// What a partner sees as "where my demo request is".
//
// Pure, no imports — same arrangement as lib/partnerProjectStages.ts, and
// for the same reason: the internal demo_schedule status enum has eleven
// values describing an INTERNAL pipeline (technical approval, manager
// approval, back-office delivery-challan preparation, dispatch, material
// return, DC closure). Most of those are logistics the partner has no stake
// in and should not be reading as progress updates on their customer's demo.
//
// "pending_backoffice" and "dc_generated" in particular would be actively
// misleading — they describe our warehouse paperwork, not whether anyone has
// agreed to do the demo.

export type PartnerDemoStatus =
  | 'requested'
  | 'under_review'
  | 'approved'
  | 'scheduled'
  | 'completed'
  | 'cancelled';

export const PARTNER_DEMO_STATUS_LABEL: Record<PartnerDemoStatus, string> = {
  requested: 'Requested',
  under_review: 'Under review',
  approved: 'Approved — being scheduled',
  scheduled: 'Scheduled',
  completed: 'Completed',
  cancelled: 'Cancelled'
};

/**
 * Collapse the internal eleven-value demo status into the six a partner
 * sees.
 *
 * Grouping rationale:
 *   draft                                   -> requested    (submitted, nobody has picked it up)
 *   pending_technical / pending_manager     -> under_review (being assessed internally)
 *   pending_backoffice / ready_for_demo /
 *   dc_generated / material_dispatched      -> approved     (agreed; we are preparing)
 *   demo_completed / material_returned /
 *   dc_closed                               -> completed    (the demo happened)
 *   cancelled                               -> cancelled
 *
 * `scheduled` is deliberately NOT derived from the status enum — no internal
 * status means "a date is agreed". It comes from scheduled_at being set,
 * which is the only honest source for it, and takes precedence over the
 * approved bucket (see resolvePartnerDemoStatus).
 */
const STATUS_GROUP: Record<string, PartnerDemoStatus> = {
  draft: 'requested',
  pending_technical: 'under_review',
  pending_manager: 'under_review',
  pending_backoffice: 'approved',
  ready_for_demo: 'approved',
  dc_generated: 'approved',
  material_dispatched: 'approved',
  demo_completed: 'completed',
  material_returned: 'completed',
  dc_closed: 'completed',
  cancelled: 'cancelled'
};

export interface PartnerDemoInput {
  status: string;
  /** The agreed date/time, or '' when none has been set yet. */
  scheduled_at: string;
}

export function resolvePartnerDemoStatus(input: PartnerDemoInput): PartnerDemoStatus {
  const group = STATUS_GROUP[input.status];
  // An unrecognised internal status (a value added later that nobody mapped)
  // falls back to 'under_review' — vague but never wrong in a way that
  // misleads, and specifically never 'completed' or 'approved', which would
  // claim something that may not have happened.
  if (!group) return 'under_review';

  if (group === 'completed' || group === 'cancelled') return group;
  // A date is agreed and the demo has not happened yet.
  if (input.scheduled_at && group === 'approved') return 'scheduled';
  return group;
}

/** Terminal states — the request needs nothing further from anyone. */
export function isPartnerDemoClosed(status: PartnerDemoStatus): boolean {
  return status === 'completed' || status === 'cancelled';
}

/**
 * Whether the partner may still cancel. Once we have committed materials
 * (dispatch, delivery challan) the cancellation is a conversation with the
 * sales person, not a button — so the portal stops offering one.
 */
export function partnerCanCancelDemo(internalStatus: string): boolean {
  return internalStatus === 'draft' || internalStatus === 'pending_technical' || internalStatus === 'pending_manager';
}
