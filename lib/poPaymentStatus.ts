import { StatusTone } from '@/components/ui/StatusBadge';

export interface PoPaymentStatus {
  tone: StatusTone;
  label: string;
}

// Purchase Orders only store a free-text "payment terms" field plus the raw
// amount/advance figures — there was no at-a-glance way to tell whether a PO
// (or a project's POs combined) is actually settled. This derives a
// pending/partial/done status purely from those two existing numbers, no new
// field required.
export function getPoPaymentStatus(po: { amount: number; advance_received: number }): PoPaymentStatus {
  const { amount, advance_received: received } = po;
  if (!(amount > 0)) return { tone: 'not_started', label: 'Amount Not Set' };
  if (received >= amount) return { tone: 'confirmed', label: 'Payment Done' };
  if (received > 0) return { tone: 'pending', label: 'Partially Received' };
  return { tone: 'rejected', label: 'Payment Pending' };
}
