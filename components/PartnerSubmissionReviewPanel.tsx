'use client';

import { useState } from 'react';
import { ProjectRecord } from '@/lib/types';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';

interface Props {
  project: ProjectRecord;
  /** Active Sales members the project can be assigned to on approval. */
  salesPeople: { id: string; username: string; name: string }[];
  onReviewed: () => void;
}

type Decision = 'approved' | 'rejected' | 'info_requested';

/**
 * The Sales reviewer's action bar on a partner submission, shown on the
 * internal project detail page.
 *
 * Rendered only while a decision is outstanding. Once accepted the project
 * is an ordinary MatrixIQ project and this disappears entirely — there is no
 * un-accept, because work (quotations, demos, assignment) starts immediately
 * afterwards and retracting acceptance would strand it. See
 * ALLOWED_REVIEW_TRANSITIONS in lib/partnerProjectStages.ts.
 */
export default function PartnerSubmissionReviewPanel({ project, salesPeople, onReviewed }: Props) {
  const [decision, setDecision] = useState<Decision | null>(null);
  const [remarks, setRemarks] = useState('');
  const [salesPersonId, setSalesPersonId] = useState('');
  const [approxPrice, setApproxPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const pending = project.partner_submission_status === 'submitted' || project.partner_submission_status === 'info_requested';
  if (!pending) return null;

  async function send(which: Decision) {
    setError('');
    setBusy(true);
    try {
      const response = await fetch(`/api/projects/${project.id}/partner-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision: which,
          remarks,
          salesPersonId: which === 'approved' ? salesPersonId : undefined,
          approxPrice: which === 'approved' ? approxPrice : undefined
        })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(body?.error || 'Could not record the decision.');
        return;
      }
      setDecision(null);
      setRemarks('');
      onReviewed();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`${historyStyles.detailPanel} ${historyStyles.detailPanelFlush}`}
      style={{ borderLeft: '4px solid var(--mx-warning, #d97706)', marginBottom: 16 }}
    >
      <strong>
        Partner submission — {project.partner_submission_status === 'submitted' ? 'awaiting your review' : 'information requested'}.
      </strong>{' '}
      Submitted by {project.partner_name} ({project.partner_code}).
      {typeof project.partner_submitted_value === 'number' && (
        <> Their estimate: ₹{project.partner_submitted_value.toLocaleString('en-IN')}.</>
      )}
      {project.partner_expected_timeline && <> Expected timeline: {project.partner_expected_timeline}.</>}

      {error && <div className={historyStyles.loginError} style={{ marginTop: 10 }}>{error}</div>}

      {!decision ? (
        <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
          <button type="button" className={calcStyles.btn} onClick={() => setDecision('approved')}>Accept &amp; assign</button>
          <button type="button" className={historyStyles.button} onClick={() => setDecision('info_requested')}>Request information</button>
          <button type="button" className={historyStyles.button} onClick={() => setDecision('rejected')}>Decline</button>
        </div>
      ) : (
        <div style={{ marginTop: 12 }}>
          {decision === 'approved' && (
            <div className={`${calcStyles.row} ${calcStyles.columns}`}>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Assign to salesperson</label>
                <select className={calcStyles.formControl} value={salesPersonId} onChange={(e) => setSalesPersonId(e.target.value)}>
                  <option value="">Choose…</option>
                  {salesPeople.map((u) => (
                    <option key={u.id} value={u.id}>{u.name || u.username}</option>
                  ))}
                </select>
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Approx. project value (₹)</label>
                <input type="number" min="0" className={calcStyles.formControl} value={approxPrice} onChange={(e) => setApproxPrice(e.target.value)} />
                {/* Stated explicitly because the partner's number is right
                    there above, and the two are easy to conflate. */}
                <span className={calcStyles.small}>Our own figure — the partner&apos;s estimate is kept separately and never overwritten.</span>
              </div>
            </div>
          )}
          <div className={calcStyles.field}>
            <label className={calcStyles.label}>
              {decision === 'approved' ? 'Note for the partner (optional)' : decision === 'rejected' ? 'Reason — the partner will see this *' : 'What do you need? The partner will see this *'}
            </label>
            <textarea className={calcStyles.formControl} rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className={calcStyles.btn} disabled={busy} onClick={() => send(decision)}>
              {busy ? 'Saving…' : decision === 'approved' ? 'Accept submission' : decision === 'rejected' ? 'Decline submission' : 'Send request'}
            </button>
            <button type="button" className={historyStyles.button} disabled={busy} onClick={() => { setDecision(null); setError(''); }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
