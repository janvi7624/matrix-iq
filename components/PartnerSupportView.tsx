'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { PartnerRecord } from '@/lib/types';
import { SUPPORT_STATUS_LABEL, SupportTicketStatus } from '@/lib/supportTicketWorkflow';
import PartnerShell from './PartnerShell';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import styles from './partnerPortal.module.css';

interface Ticket {
  id: string;
  ticket_number: string;
  title: string;
  product: string;
  customer_name: string;
  priority: string;
  status: SupportTicketStatus;
  created_at: string;
  resolution_summary: string;
  root_cause: string;
  corrective_action: string;
}

interface Comment {
  id: string;
  body: string;
  author_name: string;
  created_at: string;
}

const EMPTY = {
  title: '',
  description: '',
  issueType: 'technical',
  product: '',
  modelSerial: '',
  customerName: '',
  location: '',
  priority: 'medium',
  occurredOn: '',
  projectId: '',
  contactPerson: '',
  contactMethod: ''
};

const ISSUE_TYPES = ['technical', 'installation', 'configuration', 'maintenance', 'warranty', 'amc', 'product_failure', 'other'];

export default function PartnerSupportView({ partner }: { partner: PartnerRecord }) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [projects, setProjects] = useState<{ id: string; reference: string; company: string }[]>([]);
  const [status, setStatus] = useState('Loading...');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [openId, setOpenId] = useState<string | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/partner/support/tickets');
      if (!response.ok) throw new Error(String(response.status));
      const data: Ticket[] = await response.json();
      setTickets(data);
      setStatus(data.length ? '' : 'You have not raised any support tickets.');
    } catch {
      setStatus('Could not load your tickets. Refresh to try again.');
    }
  }, []);

  useEffect(() => {
    load();
    fetch('/api/partner/projects')
      .then((r) => (r.ok ? r.json() : []))
      .then(setProjects)
      .catch(() => setProjects([]));
  }, [load]);

  async function openTicket(id: string) {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    setComments([]);
    const response = await fetch(`/api/partner/support/tickets/${id}`);
    if (response.ok) {
      const data = await response.json();
      setComments(data.comments ?? []);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const response = await fetch('/api/partner/support/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      if (!response.ok) {
        const b = await response.json().catch(() => null);
        setError(b?.error || 'Could not raise the ticket.');
        return;
      }
      setForm(EMPTY);
      setShowForm(false);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function sendReply(id: string) {
    setError('');
    const response = await fetch(`/api/partner/support/tickets/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: reply })
    });
    if (!response.ok) {
      const b = await response.json().catch(() => null);
      setError(b?.error || 'Could not send your reply.');
      return;
    }
    setReply('');
    await openTicket(id);
    await openTicket(id);
  }

  async function respond(id: string, nextStatus: 'closed' | 'reopened') {
    setError('');
    const response = await fetch(`/api/partner/support/tickets/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus, reason: nextStatus === 'reopened' ? 'Issue still present' : 'Confirmed resolved' })
    });
    if (!response.ok) {
      const b = await response.json().catch(() => null);
      setError(b?.error || 'Could not update the ticket.');
      return;
    }
    await load();
  }

  return (
    <PartnerShell
      title="Technical Support"
      subtitle="Raise and track after-sales support tickets"
      partnerName={partner.company_name}
      partnerCode={partner.partner_code}
    >
      {error && <div className={historyStyles.loginError}>{error}</div>}

      {showForm ? (
        <form className={calcStyles.sectionPanel} onSubmit={submit}>
          <h2 className={`${calcStyles.h2} ${calcStyles.h2Flush}`}>Raise a support ticket</h2>
          <div className={calcStyles.field}>
            <label className={calcStyles.label} htmlFor="st">Title *</label>
            <input id="st" className={calcStyles.formControl} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          </div>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="sty">Issue type</label>
              <select id="sty" className={calcStyles.formControl} value={form.issueType} onChange={(e) => setForm({ ...form, issueType: e.target.value })}>
                {ISSUE_TYPES.map((t) => (
                  <option key={t} value={t}>{t.replace('_', ' ')}</option>
                ))}
              </select>
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="sp">Business impact</label>
              <select id="sp" className={calcStyles.formControl} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                <option value="low">Low — minor inconvenience</option>
                <option value="medium">Medium — partially impaired</option>
                <option value="high">High — major function unusable</option>
                <option value="critical">Critical — system down</option>
              </select>
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="sprj">Related project</label>
              <select id="sprj" className={calcStyles.formControl} value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>
                <option value="">Not linked</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.reference} — {p.company}</option>
                ))}
              </select>
            </div>
          </div>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="spr">Product</label>
              <input id="spr" className={calcStyles.formControl} value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="sms">Model / serial number</label>
              <input id="sms" className={calcStyles.formControl} value={form.modelSerial} onChange={(e) => setForm({ ...form, modelSerial: e.target.value })} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="sdt">Date the issue occurred</label>
              <input id="sdt" type="date" className={calcStyles.formControl} value={form.occurredOn} onChange={(e) => setForm({ ...form, occurredOn: e.target.value })} />
            </div>
          </div>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="scn">Customer</label>
              <input id="scn" className={calcStyles.formControl} value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="sloc">Installation site</label>
              <input id="sloc" className={calcStyles.formControl} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="scp">Contact person</label>
              <input id="scp" className={calcStyles.formControl} value={form.contactPerson} onChange={(e) => setForm({ ...form, contactPerson: e.target.value })} />
            </div>
          </div>
          <div className={calcStyles.field}>
            <label className={calcStyles.label} htmlFor="sd">Describe the issue *</label>
            <textarea id="sd" rows={5} className={calcStyles.formControl} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className={calcStyles.btn} disabled={busy}>{busy ? 'Submitting...' : 'Raise ticket'}</button>
            <button type="button" className={historyStyles.button} onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <section className={styles.intro}>
          <h2 className={styles.introTitle}>Need technical help?</h2>
          <p className={styles.introSub}>
            Raise a ticket and our technical team will pick it up. You can follow progress and reply here.
          </p>
          <button type="button" className={calcStyles.btn} style={{ marginTop: 12 }} onClick={() => setShowForm(true)}>+ New ticket</button>
        </section>
      )}

      <h3 className={styles.sectionHeading}>Your tickets</h3>
      {status && <div className={historyStyles.status}>{status}</div>}

      {tickets.map((t) => (
        <div key={t.id} className={calcStyles.sectionPanel}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <strong>{t.ticket_number}</strong> — {t.title}
              <div className={calcStyles.small}>
                {t.product || 'No product'} · raised {new Date(t.created_at).toLocaleDateString()}
              </div>
            </div>
            <span className={historyStyles.statusPill}>{SUPPORT_STATUS_LABEL[t.status] ?? t.status}</span>
          </div>

          {t.status === 'resolved' && (
            <div style={{ marginTop: 10 }}>
              {t.resolution_summary && <p><strong>What we did:</strong> {t.resolution_summary}</p>}
              {t.root_cause && <p className={calcStyles.small}><strong>Root cause:</strong> {t.root_cause}</p>}
              <p className={calcStyles.small}>Is this fixed?</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className={calcStyles.btn} onClick={() => respond(t.id, 'closed')}>Yes, close it</button>
                <button type="button" className={historyStyles.button} onClick={() => respond(t.id, 'reopened')}>No, still a problem</button>
              </div>
            </div>
          )}

          <button type="button" className={historyStyles.button} style={{ marginTop: 10 }} onClick={() => openTicket(t.id)}>
            {openId === t.id ? 'Hide conversation' : 'View conversation'}
          </button>

          {openId === t.id && (
            <div style={{ marginTop: 10 }}>
              {comments.length === 0 && <p className={calcStyles.small}>No messages yet.</p>}
              {comments.map((c) => (
                <div key={c.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--mx-border)' }}>
                  <div className={calcStyles.small}><strong>{c.author_name}</strong> · {new Date(c.created_at).toLocaleString()}</div>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{c.body}</div>
                </div>
              ))}
              <textarea className={calcStyles.formControl} rows={3} placeholder="Add a message..." value={reply} onChange={(e) => setReply(e.target.value)} style={{ marginTop: 10 }} />
              <button type="button" className={calcStyles.btn} onClick={() => sendReply(t.id)} disabled={!reply.trim()}>Send</button>
            </div>
          )}
        </div>
      ))}
    </PartnerShell>
  );
}
