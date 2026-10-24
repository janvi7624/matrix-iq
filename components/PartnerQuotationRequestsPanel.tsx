'use client';

import { FormEvent, useEffect, useState } from 'react';
import {
  PARTNER_QUOTATION_REQUEST_LABEL,
  QUOTATION_REQUEST_URGENCIES,
  QuotationRequestStatus,
  partnerProgressPercent
} from '@/lib/partnerQuotationRequestStages';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import styles from './partnerPortal.module.css';

// The partner asking us to price something, and the list of what they have
// already asked for.
//
// Its own component rather than more of PartnerQuotationsView: that view is
// about documents we have SHARED, this is about asks that have no document
// yet. Keeping them apart is also what stops a pending ask from reading like
// a quotation the partner already has.

interface QuotationRequest {
  id: string;
  project_id: string;
  project_label: string;
  requirements: string;
  products: string;
  quantity_note: string;
  needed_by: string;
  urgency: string;
  status: QuotationRequestStatus;
  created_at: string;
  response_note: string;
  quotation_id: string;
  quotation_number: string;
}

interface ProjectOption {
  id: string;
  project_name: string;
  client_name: string;
  company: string;
}

function date(value: string): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

const EMPTY = { projectId: '', requirements: '', products: '', quantityNote: '', neededBy: '', urgency: 'medium' };

export default function PartnerQuotationRequestsPanel({ onQuoted }: { onQuoted?: () => void }) {
  const [requests, setRequests] = useState<QuotationRequest[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  // Async IIFE with a cancelled guard, matching components/MaterialsView.tsx
  // — a loader called straight from the effect body sets state during the
  // effect and cascades renders.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/partner/quotation-requests');
        const rows = response.ok ? await response.json() : [];
        if (!cancelled) setRequests(Array.isArray(rows) ? rows : []);
      } catch {
        if (!cancelled) setRequests([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/partner/projects');
        const rows = response.ok ? await response.json() : [];
        if (!cancelled) setProjects(Array.isArray(rows) ? rows : []);
      } catch {
        if (!cancelled) setProjects([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setSending(true);
    try {
      const response = await fetch('/api/partner/quotation-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.error || 'Could not send this request.');
        return;
      }
      setForm(EMPTY);
      setOpen(false);
      setReloadKey((k) => k + 1);
      onQuoted?.();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setSending(false);
    }
  }

  return (
    <section>
      <div className={styles.detailHeader}>
        <div>
          <div className={styles.detailHeaderTitle}>Quotation requests</div>
          <div className={styles.detailHeaderMeta}>Ask our sales team to price something for one of your projects</div>
        </div>
        {!open && (
          <button type="button" className={calcStyles.btn} onClick={() => { setOpen(true); setError(''); }}>
            Request a quotation
          </button>
        )}
      </div>

      {open && (
        <form className={calcStyles.sectionPanel} onSubmit={submit}>
          {error && <div className={historyStyles.loginError}>{error}</div>}

          <div className={calcStyles.field}>
            <label className={calcStyles.label}>Which project is this for? *</label>
            <select
              className={calcStyles.formControl}
              value={form.projectId}
              onChange={(e) => setForm({ ...form, projectId: e.target.value })}
              required
            >
              <option value="">— Select one of your projects —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.project_name || p.client_name}
                  {p.company ? ` — ${p.company}` : ''}
                </option>
              ))}
            </select>
            {projects.length === 0 && (
              // Said plainly rather than leaving an empty dropdown: a
              // quotation is always FOR something, so there is nothing to
              // request until a project exists.
              <span className={calcStyles.small}>
                You have no projects yet. Submit one under “My Leads / Projects” first.
              </span>
            )}
          </div>

          <div className={calcStyles.field}>
            <label className={calcStyles.label}>What do you need quoted? *</label>
            <textarea
              className={calcStyles.formControl}
              rows={4}
              value={form.requirements}
              onChange={(e) => setForm({ ...form, requirements: e.target.value })}
              placeholder="Describe the requirement — rooms, sizes, site conditions, anything that affects the price."
              required
            />
          </div>

          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Products (optional)</label>
              <input
                type="text"
                className={calcStyles.formControl}
                value={form.products}
                onChange={(e) => setForm({ ...form, products: e.target.value })}
                placeholder="e.g. MeetIQ 65&quot;, ceiling mic"
              />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Quantity (optional)</label>
              <input
                type="text"
                className={calcStyles.formControl}
                value={form.quantityNote}
                onChange={(e) => setForm({ ...form, quantityNote: e.target.value })}
                placeholder="e.g. 4 rooms, 2 units each"
              />
            </div>
          </div>

          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Needed by (optional)</label>
              <input
                type="date"
                className={calcStyles.formControl}
                value={form.neededBy}
                onChange={(e) => setForm({ ...form, neededBy: e.target.value })}
              />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Urgency</label>
              <select
                className={calcStyles.formControl}
                value={form.urgency}
                onChange={(e) => setForm({ ...form, urgency: e.target.value })}
              >
                {QUOTATION_REQUEST_URGENCIES.map((u) => (
                  <option key={u} value={u}>{u[0].toUpperCase() + u.slice(1)}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="submit" className={calcStyles.btn} disabled={sending || projects.length === 0}>
              {sending ? 'Sending…' : 'Send request'}
            </button>
            <button type="button" className={historyStyles.button} disabled={sending} onClick={() => { setOpen(false); setError(''); }}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {requests.length > 0 ? (
        <div className={styles.cardGrid}>
          {requests.map((r) => (
            <div key={r.id} className={styles.card}>
              <p className={styles.cardTitle}>{r.project_label || 'Project'}</p>
              <p className={styles.cardDesc}>{r.requirements}</p>
              <p className={styles.cardDesc} style={{ marginTop: 6 }}>
                <span className={styles.statusChip}>{PARTNER_QUOTATION_REQUEST_LABEL[r.status]}</span>
                {r.needed_by ? ` · needed by ${date(r.needed_by)}` : ''}
              </p>
              {r.status !== 'declined' && (
                <div className={styles.progressBarOuter} style={{ marginTop: 8 }}>
                  <div className={styles.progressBarInner} style={{ width: `${partnerProgressPercent(r.status)}%` }} />
                </div>
              )}
              {r.response_note && (
                <p className={styles.cardDesc} style={{ marginTop: 6 }}>
                  <strong>From our sales team:</strong> {r.response_note}
                </p>
              )}
              {/* Only appears once the quotation is actually shared — the
                  number comes from the share, not from the request row. */}
              {r.quotation_number && (
                <p className={styles.cardDesc} style={{ marginTop: 6 }}>
                  Quotation <strong>{r.quotation_number}</strong> — see the list below.
                </p>
              )}
              <p className={styles.cardDesc} style={{ marginTop: 6 }}>Asked {date(r.created_at)}</p>
            </div>
          ))}
        </div>
      ) : (
        !open && <p className={styles.pending}>You haven’t requested any quotations yet.</p>
      )}
    </section>
  );
}
