import { QuotationRecord } from './types';
import { computeEffectiveStatusClient } from './quotationStatus';

// Same reasoning as lib/projectVisibility.ts, applied to quotations: a
// finished quote sitting in the list forever is clutter.
//
// WHY STATUS AND NOT AGE
// This used to wait 90 days (CLOSED_QUOTATION_HIDE_AFTER_DAYS), and against
// the live data that removed nothing at all: every closed quotation closed
// within the last 30 days.
//
//   hide on status  -> 45 of 57 rows
//   hide after 30d  ->  0 rows
//   hide after 90d  ->  0 rows
//
// An invisible delay is also a worse control than a visible rule: a row that
// disappears on a date nobody can see reads as data loss.
//
// EXPIRED COUNTS AS REJECTED, by business decision: a quotation whose validity
// ran out with no answer is a dead deal, not an open one. So it is closed, and
// it hides with the rest.
//
// Be aware what that costs, because it is the larger half of the list. 29 of
// the 40 'sent' quotations are already past validity, so this hides 45 of 57
// rows and leaves 12. That is the intent — but it does take the follow-up
// backlog out of the default view, and the way back to it is the Rejected or
// Expired filter. Expired is the sharper of the two: it separates the ones
// that died from silence from the ones actively turned down.
//
// computeEffectiveStatusClient is used rather than a bare status check for two
// reasons: expiry is derived (created_at + validity_days) rather than stored,
// and a quote can be approved while ALSO past its validity — the resolution
// has to win over the expiry.
//
// Nothing is deleted or unreachable. See components/QuotationHistoryView.tsx,
// and lib/quotationStore.ts, where the Rejected filter is the umbrella that
// returns the expired ones too.

type VisibilityRecord = Pick<QuotationRecord, 'status' | 'created_at' | 'validity_days' | 'status_changed_at'>;

export function isClosedQuotation(record: VisibilityRecord): boolean {
  const effective = computeEffectiveStatusClient(record);
  return effective === 'approved' || effective === 'rejected' || effective === 'expired';
}

/** The quotation counterpart of closedProjectsVisible — same three ways in. */
export function closedQuotationsVisible(input: {
  statusFilter?: string;
  dateFilterActive?: boolean;
  userOverride?: boolean;
}): boolean {
  if (input.userOverride) return true;
  if (input.dateFilterActive) return true;
  const status = (input.statusFilter ?? '').trim();
  return status === 'approved' || status === 'rejected' || status === 'expired';
}
