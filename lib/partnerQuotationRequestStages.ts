// The lifecycle of a partner's request for a quotation.
//
// Four values, held as a STRING column rather than a Postgres enum for the
// reason support_tickets does the same: an enum value cannot be dropped once
// added, and a workflow this young will be revised. This module is the
// authority on which values exist and which moves are legal — the column
// merely stores whatever this allows.
//
// Pure, no imports: the store validates with it, the API routes validate
// with it, and both clients label with it, so there is one answer to "can
// this move there?" rather than three.

export const QUOTATION_REQUEST_STATUSES = ['open', 'in_progress', 'quoted', 'declined'] as const;

export type QuotationRequestStatus = (typeof QUOTATION_REQUEST_STATUSES)[number];

export function isQuotationRequestStatus(value: string): value is QuotationRequestStatus {
  return (QUOTATION_REQUEST_STATUSES as readonly string[]).includes(value);
}

/** What Sales sees. */
export const QUOTATION_REQUEST_STATUS_LABEL: Record<QuotationRequestStatus, string> = {
  open: 'New request',
  in_progress: 'Being prepared',
  quoted: 'Quotation sent',
  declined: 'Declined'
};

/**
 * What the PARTNER sees. Deliberately warmer and less internal: 'open' is
 * our queue state, "Received" is what it means to the person who asked.
 */
export const PARTNER_QUOTATION_REQUEST_LABEL: Record<QuotationRequestStatus, string> = {
  open: 'Received',
  in_progress: 'Being prepared',
  quoted: 'Quotation ready',
  declined: 'Not quoted'
};

export const QUOTATION_REQUEST_URGENCIES = ['low', 'medium', 'high'] as const;
export type QuotationRequestUrgency = (typeof QUOTATION_REQUEST_URGENCIES)[number];

export function isQuotationRequestUrgency(value: string): value is QuotationRequestUrgency {
  return (QUOTATION_REQUEST_URGENCIES as readonly string[]).includes(value);
}

/**
 * Legal moves, keyed by current status.
 *
 * 'quoted' is terminal because the thing the request asked for now exists —
 * a further change belongs to the quotation, which has its own
 * draft/sent/approved/rejected lifecycle. Re-opening a quoted request would
 * create two records claiming to own the same conversation.
 *
 * 'declined' is NOT terminal: a customer coming back with a real budget is
 * ordinary, and forcing a duplicate request to capture that would lose the
 * history of the first ask.
 */
const ALLOWED_TRANSITIONS: Record<QuotationRequestStatus, QuotationRequestStatus[]> = {
  open: ['in_progress', 'quoted', 'declined'],
  in_progress: ['quoted', 'declined', 'open'],
  quoted: [],
  declined: ['open', 'in_progress']
};

export function canTransition(from: string, to: QuotationRequestStatus): boolean {
  if (!isQuotationRequestStatus(from)) return false;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Is this request still work for someone? Drives the queue and the badge. */
export function isOpenRequest(status: string): boolean {
  return status === 'open' || status === 'in_progress';
}

/**
 * A decline must say why, and a quotation must point at the document.
 *
 * Kept here rather than in the route so the store enforces it too — a rule
 * that lives only in a handler is one POST away from being bypassed.
 */
export function requiresResponseNote(to: QuotationRequestStatus): boolean {
  return to === 'declined';
}

export function requiresQuotation(to: QuotationRequestStatus): boolean {
  return to === 'quoted';
}

/** Progress for the partner's bar. Declined is not a position on the path. */
export function partnerProgressPercent(status: string): number {
  switch (status) {
    case 'open':
      return 33;
    case 'in_progress':
      return 66;
    case 'quoted':
      return 100;
    default:
      return 0;
  }
}
