'use client';

import { Check, X } from 'lucide-react';
import Modal, { ModalCancelButton } from './Modal';
import styles from './decisionModal.module.css';

// Approve / Reject confirmation as a pop-up — opens right where the button
// was clicked, shows what is being decided, and takes the remark there, so
// nobody has to scroll to a panel that appeared somewhere else on the page.
// A remark is required to reject (the requester needs to know why).
export default function DecisionModal({
  decision,
  title,
  summary,
  remark,
  onRemarkChange,
  busy,
  onConfirm,
  onClose
}: {
  decision: 'approve' | 'reject';
  title: string;
  /** Label/value pairs describing what is being decided. */
  summary: { label: string; value: string }[];
  remark: string;
  onRemarkChange: (v: string) => void;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const approving = decision === 'approve';
  const blocked = !approving && !remark.trim();
  return (
    <Modal
      title={title}
      ariaLabel={title}
      onClose={onClose}
      dismissible={!busy}
      footer={
        <>
          <ModalCancelButton onClick={onClose} disabled={busy}>Cancel</ModalCancelButton>
          <button type="button" className={approving ? styles.approve : styles.reject} disabled={busy || blocked} onClick={onConfirm}>
            {approving ? <Check size={15} /> : <X size={15} />}
            {busy ? 'Saving…' : approving ? 'Approve' : 'Reject'}
          </button>
        </>
      }
    >
      {summary.length > 0 && (
        <dl className={styles.summary}>
          {summary.map((s) => (
            <div key={s.label} className={styles.summaryRow}>
              <dt>{s.label}</dt>
              <dd>{s.value || '—'}</dd>
            </div>
          ))}
        </dl>
      )}
      <label className={styles.label} htmlFor="decision-remark">
        Remark {approving ? <span className={styles.muted}>(optional)</span> : <span className={styles.required}>* required</span>}
      </label>
      <textarea
        id="decision-remark"
        className={styles.input}
        rows={3}
        autoFocus
        placeholder={approving ? 'Anything to add for the requester' : 'Tell the requester why this is rejected'}
        value={remark}
        onChange={(e) => onRemarkChange(e.target.value)}
      />
    </Modal>
  );
}
