'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  SUPPORT_STATUS_LABEL,
  SupportActor,
  SupportTicketStatus,
  allowedTransitions,
  transitionRequiresReason
} from '@/lib/supportTicketWorkflow';
import AppShell from './AppShell';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import styles from './partnerPortal.module.css';

interface Comment {
  id: string;
  body: string;
  is_internal: boolean;
  author_name: string;
  created_at: string;
}

interface Ticket {
  id: string;
  ticket_number: string;
  title: string;
  description: string;
  category: string;
  issue_type: string;
  product: string;
  model_serial: string;
  customer_name: string;
  location: string;
  priority: string;
  status: SupportTicketStatus;
  partner_name: string;
  assignee_name: string;
  assignee_id: string;
  created_by_name: string;
  created_at: string;
  occurred_on: string;
  resolution_summary: string;
  root_cause: string;
  corrective_action: string;
  reopened_count: number;
  sla: { breached: boolean; responseState: string; resolutionState: string; minutesRemaining: number | null } | null;
}

interface Payload {
  ticket: Ticket;
  comments: Comment[];
  history: { from_status: string | null; to_status: string; at: string }[];
  actor: SupportActor | null;
}

export default function SupportTicketDetailView({ ticketId }: { ticketId: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [engineers, setEngineers] = useState<{ id: string; name: string }[]>([]);
  const [status, setStatus] = useState('Loading...');
  const [error, setError] = useState('');
  const [comment, setComment] = useState('');
  const [commentInternal, setCommentInternal] = useState(true);
  const [pendingStatus, setPendingStatus] = useState<SupportTicketStatus | ''>('');
  const [reason, setReason] = useState('');
  const [resolution, setResolution] = useState({ summary: '', rootCause: '', correctiveAction: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/support/tickets/${ticketId}`);
      if (!response.ok) {
        setStatus(response.status === 403 ? 'You do not have access to this ticket.' : 'Ticket not found.');
        return;
      }
      setData(await response.json());
      setStatus('');
    } catch {
      setStatus('Could not reach the server.');
    }
  }, [ticketId]);

  useEffect(() => {
    load();
    fetch('/api/support/tickets?queue=open')
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => setEngineers(body?.engineers ?? []))
      .catch(() => undefined);
  }, [load]);

  async function patch(payload: Record<string, unknown>) {
    setError('');
    setBusy(true);
    try {
      const response = await fetch(`/api/support/tickets/${ticketId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        const b = await response.json().catch(() => null);
        setError(b?.error || 'Could not update the ticket.');
        return false;
      }
      await load();
      return true;
    } catch {
      setError('Could not reach the server.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submitComment(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const response = await fetch(`/api/support/tickets/${ticketId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: comment, isInternal: commentInternal })
      });
      if (!response.ok) {
        const b = await response.json().catch(() => null);
        setError(b?.error || 'Could not post the comment.');
        return;
      }
      setComment('');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function applyStatus() {
    if (!pendingStatus) return;
    const ok = await patch({
      status: pendingStatus,
      reason,
      resolutionSummary: resolution.summary,
      rootCause: resolution.rootCause,
      correctiveAction: resolution.correctiveAction
    });
    if (ok) {
      setPendingStatus('');
      setReason('');
      setResolution({ summary: '', rootCause: '', correctiveAction: '' });
    }
  }

  if (!data) {
    return (
      <AppShell title="Support ticket" subtitle="Operations › technical support">
        <div className={historyStyles.status}>{status}</div>
        <Link className={historyStyles.button} href="/support">← All tickets</Link>
      </AppShell>
    );
  }

  const { ticket, comments, history, actor } = data;
  const canAct = actor === 'manager' || actor === 'engineer';
  const options = actor ? allowedTransitions(ticket.status, actor) : [];

  return (
    <AppShell title={`${ticket.ticket_number} — ${ticket.title}`} subtitle="Operations › technical support">
      <div style={{ marginBottom: 12 }}>
        <Link className={historyStyles.button} href="/support">← All tickets</Link>
      </div>
      {error && <div className={historyStyles.loginError}>{error}</div>}

      <section className={styles.intro}>
        <h2 className={styles.introTitle}>{SUPPORT_STATUS_LABEL[ticket.status] ?? ticket.status}</h2>
        <p className={styles.introSub}>
          {ticket.partner_name ? `Raised by ${ticket.partner_name}` : `Raised internally by ${ticket.created_by_name}`}
          {' · '}priority {ticket.priority}
          {ticket.assignee_name ? ` · assigned to ${ticket.assignee_name}` : ' · unassigned'}
          {ticket.reopened_count > 0 ? ` · reopened ${ticket.reopened_count}×` : ''}
        </p>
        {ticket.sla && (
          <p className={styles.introSub} style={{ color: ticket.sla.breached ? 'var(--mx-danger)' : undefined }}>
            SLA: response {ticket.sla.responseState}, resolution {ticket.sla.resolutionState}
            {ticket.sla.minutesRemaining !== null && !ticket.sla.breached ? ` — ${ticket.sla.minutesRemaining}m left` : ''}
          </p>
        )}
      </section>

      {canAct && (
        <div className={calcStyles.sectionPanel}>
          <h2 className={`${calcStyles.h2} ${calcStyles.h2Flush}`}>Actions</h2>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            {actor === 'manager' && (
              <>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Assign to</label>
                  <select className={calcStyles.formControl} value={ticket.assignee_id} onChange={(e) => patch({ assigneeId: e.target.value })}>
                    <option value="">Unassigned</option>
                    {engineers.map((u) => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                </div>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Priority</label>
                  <select className={calcStyles.formControl} value={ticket.priority} onChange={(e) => patch({ priority: e.target.value })}>
                    {['low', 'medium', 'high', 'critical'].map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                  <span className={calcStyles.small}>Changing priority restamps the SLA targets from the ticket&apos;s creation time.</span>
                </div>
              </>
            )}
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Move to</label>
              <select className={calcStyles.formControl} value={pendingStatus} onChange={(e) => setPendingStatus(e.target.value as SupportTicketStatus)}>
                <option value="">Choose…</option>
                {/* Only transitions this actor may actually make — the server
                    re-checks the same table, so this is convenience, not the gate. */}
                {options.map((s) => (
                  <option key={s} value={s}>{SUPPORT_STATUS_LABEL[s]}</option>
                ))}
              </select>
            </div>
          </div>

          {pendingStatus && (
            <>
              {pendingStatus === 'resolved' && (
                <div className={`${calcStyles.row} ${calcStyles.columns}`}>
                  <div className={calcStyles.field}>
                    <label className={calcStyles.label}>Resolution summary</label>
                    <textarea className={calcStyles.formControl} rows={2} value={resolution.summary} onChange={(e) => setResolution({ ...resolution, summary: e.target.value })} />
                  </div>
                  <div className={calcStyles.field}>
                    <label className={calcStyles.label}>Root cause</label>
                    <textarea className={calcStyles.formControl} rows={2} value={resolution.rootCause} onChange={(e) => setResolution({ ...resolution, rootCause: e.target.value })} />
                  </div>
                  <div className={calcStyles.field}>
                    <label className={calcStyles.label}>Corrective action</label>
                    <textarea className={calcStyles.formControl} rows={2} value={resolution.correctiveAction} onChange={(e) => setResolution({ ...resolution, correctiveAction: e.target.value })} />
                  </div>
                </div>
              )}
              {transitionRequiresReason(pendingStatus) && (
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Reason *</label>
                  <textarea className={calcStyles.formControl} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
                </div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className={calcStyles.btn} disabled={busy} onClick={applyStatus}>Apply</button>
                <button type="button" className={historyStyles.button} onClick={() => setPendingStatus('')}>Cancel</button>
              </div>
            </>
          )}
        </div>
      )}

      <h3 className={styles.sectionHeading}>Issue</h3>
      <div className={calcStyles.sectionPanel}>
        <div className={styles.cardGrid} style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <div><strong>Customer</strong><div>{ticket.customer_name || '-'}</div></div>
          <div><strong>Product</strong><div>{ticket.product || '-'}</div></div>
          <div><strong>Model / serial</strong><div>{ticket.model_serial || '-'}</div></div>
          <div><strong>Type</strong><div>{ticket.issue_type || '-'}</div></div>
          <div><strong>Location</strong><div>{ticket.location || '-'}</div></div>
          <div><strong>Occurred</strong><div>{ticket.occurred_on || '-'}</div></div>
        </div>
        <p style={{ marginTop: 12, whiteSpace: 'pre-wrap' }}>{ticket.description}</p>
        {ticket.resolution_summary && (
          <>
            <h3 className={styles.sectionHeading}>Resolution</h3>
            <p style={{ whiteSpace: 'pre-wrap' }}>{ticket.resolution_summary}</p>
            {ticket.root_cause && <p className={calcStyles.small}><strong>Root cause:</strong> {ticket.root_cause}</p>}
            {ticket.corrective_action && <p className={calcStyles.small}><strong>Corrective action:</strong> {ticket.corrective_action}</p>}
          </>
        )}
      </div>

      <h3 className={styles.sectionHeading}>Conversation</h3>
      <div className={calcStyles.sectionPanel}>
        {comments.length === 0 && <p className={calcStyles.small}>No messages yet.</p>}
        {comments.map((c) => (
          <div key={c.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--mx-border)' }}>
            <div className={calcStyles.small}>
              <strong>{c.author_name}</strong> · {new Date(c.created_at).toLocaleString()}
              {' · '}
              {/* The internal/external distinction is shown on every message,
                  not just implied by placement — an engineer must be able to
                  tell at a glance what the partner can read. */}
              <span style={{ color: c.is_internal ? 'var(--mx-warning)' : 'var(--mx-success)' }}>
                {c.is_internal ? 'Internal note' : 'Visible to partner'}
              </span>
            </div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{c.body}</div>
          </div>
        ))}

        {canAct && (
          <form onSubmit={submitComment} style={{ marginTop: 12 }}>
            <textarea className={calcStyles.formControl} rows={3} value={comment} onChange={(e) => setComment(e.target.value)} required />
            <label className={calcStyles.small} style={{ display: 'block', margin: '8px 0' }}>
              <input type="checkbox" checked={commentInternal} onChange={(e) => setCommentInternal(e.target.checked)} />{' '}
              Internal note — not visible to the partner
            </label>
            <button type="submit" className={calcStyles.btn} disabled={busy}>Post</button>
          </form>
        )}
      </div>

      <h3 className={styles.sectionHeading}>Status history</h3>
      <div className={historyStyles.tableWrap}>
        <table className={historyStyles.table}>
          <thead>
            <tr><th>When</th><th>From</th><th>To</th></tr>
          </thead>
          <tbody>
            {history.map((h, i) => (
              <tr key={i}>
                <td>{new Date(h.at).toLocaleString()}</td>
                <td>{h.from_status ? SUPPORT_STATUS_LABEL[h.from_status as SupportTicketStatus] ?? h.from_status : '—'}</td>
                <td>{SUPPORT_STATUS_LABEL[h.to_status as SupportTicketStatus] ?? h.to_status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
