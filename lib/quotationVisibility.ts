import { QuotationRecord } from './types';
import { computeEffectiveStatusClient } from './quotationStatus';

// Same reasoning as lib/projectVisibility.ts's Won/Lost rule, applied to
// quotations: an Approved/Rejected/Expired quote sitting in the list forever
// is clutter. Ages out of the default (no Status filter) view after this
// many days; picking Approved, Rejected, or Expired explicitly in the
// Status filter still shows every one of them, aged or not (see
// components/QuotationHistoryView.tsx).
export const CLOSED_QUOTATION_HIDE_AFTER_DAYS = 90;

export function isAgedClosedQuotation(
  record: Pick<QuotationRecord, 'status' | 'created_at' | 'validity_days' | 'status_changed_at'>,
  now: Date = new Date()
): boolean {
  const effective = computeEffectiveStatusClient(record);
  let closedAtMs: number | null = null;
  if (effective === 'approved' || effective === 'rejected') {
    if (!record.status_changed_at) return false;
    const t = new Date(record.status_changed_at).getTime();
    if (Number.isNaN(t)) return false;
    closedAtMs = t;
  } else if (effective === 'expired') {
    const createdAt = new Date(record.created_at).getTime();
    if (Number.isNaN(createdAt)) return false;
    closedAtMs = createdAt + (record.validity_days || 0) * 24 * 60 * 60 * 1000;
  } else {
    return false;
  }
  const daysSinceClosed = (now.getTime() - closedAtMs) / (1000 * 60 * 60 * 24);
  return daysSinceClosed > CLOSED_QUOTATION_HIDE_AFTER_DAYS;
}
