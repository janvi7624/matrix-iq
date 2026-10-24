'use client';

import { useState } from 'react';
import { Share2, Loader2 } from 'lucide-react';
import { useToast } from './ui/ToastProvider';
import { useConfirm } from './ui/ConfirmDialog';
import styles from './quotationHistory.module.css';

interface Props {
  quotationId: string;
  quotationNumber: string;
  /** '' on a direct quotation — the control then renders nothing. */
  partnerId?: string;
  /** "Acme Systems (PTR-0001)" — already formatted for display. */
  partnerName?: string;
  sharedWithPartner?: boolean;
  /** A draft cannot be shared; the button says so rather than vanishing. */
  shareable: boolean;
  onChanged: () => void;
}

/**
 * Publish a quotation to the partner who submitted its project — or withdraw
 * it again.
 *
 * Renders NOTHING at all on a quotation whose project is not partner-sourced.
 * That is deliberate: there is exactly one partner a given quotation may be
 * shared with (the store refuses any other), so a partner dropdown would be a
 * list of options that mostly 400. If there is no eligible partner there is
 * no decision to offer.
 *
 * Takes everything it needs as props. The partner and share state are
 * resolved once for the whole list in lib/quotationStore.ts — a per-row
 * eligibility fetch would be one request per row, i.e. thirty requests to
 * decide whether to draw thirty buttons.
 */
export default function QuotationSharePartnerButton({
  quotationId,
  quotationNumber,
  partnerId,
  partnerName,
  sharedWithPartner,
  shareable,
  onChanged
}: Props) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();

  // Nothing to decide on a quotation whose project is not partner-sourced.
  // There is exactly one partner a given quotation may be shared with (the
  // store refuses any other), so this is never a choice — it is an action or
  // it is absent.
  if (!partnerId) return null;
  // Re-bound as a non-optional local: the early return above narrows the
  // prop here, but not inside the async closures below.
  const sharedPartnerId: string = partnerId;
  const live = sharedWithPartner === true;

  async function share() {
    setBusy(true);
    try {
      const response = await fetch(`/api/quotations/${quotationId}/share-partner`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partnerId: sharedPartnerId })
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error(body?.error || 'Could not share this quotation.');
        return;
      }
      toast.success(`${quotationNumber} is now visible to ${partnerName}.`);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    const ok = await confirm({
      message: `Withdraw ${quotationNumber} from ${partnerName}? They will no longer see it in their portal.`
    });
    if (!ok) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/quotations/${quotationId}/share-partner?partnerId=${encodeURIComponent(sharedPartnerId)}`, {
        method: 'DELETE'
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        toast.error(body?.error || 'Could not withdraw this quotation.');
        return;
      }
      toast.success(`Withdrawn from ${partnerName}.`);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  // A draft cannot be shared. Showing a disabled button that explains why
  // beats hiding the control and leaving the salesperson wondering where it
  // went on this one quotation.
  if (!shareable && !live) {
    return (
      <button
        type="button"
        className={styles.rowAction}
        disabled
        title={`Finalise ${quotationNumber} before sharing it with ${partnerName}.`}
      >
        <Share2 size={14} aria-hidden />
        <span className={styles.rowActionLabel}>Share</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      className={styles.rowAction}
      disabled={busy}
      title={
        live
          ? `Shared with ${partnerName} — click to withdraw`
          : `Share ${quotationNumber} with ${partnerName}`
      }
      onClick={live ? revoke : share}
    >
      {busy ? <Loader2 size={14} className={styles.rowActionSpin} aria-hidden /> : <Share2 size={14} aria-hidden />}
      <span className={`${styles.rowActionLabel} ${styles.rowActionLabelFixed}`}>
        {busy ? 'Working…' : live ? 'Shared' : 'Share'}
      </span>
    </button>
  );
}
