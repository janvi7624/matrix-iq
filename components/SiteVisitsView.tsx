'use client';

import { FormEvent, Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { SiteVisitRecord } from '@/lib/types';
import PortalHeader from './PortalHeader';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';

const EMPTY_FORM = {
  clientName: '',
  clientCompany: '',
  address: '',
  visitDate: '',
  attendees: '',
  findings: '',
  linkedQuotationNumber: '',
  nextSteps: ''
};

function formatDate(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleDateString('en-IN');
  } catch {
    return iso;
  }
}

function SiteVisitRow({ visit, onUpdate, onDelete }: { visit: SiteVisitRecord; onUpdate: (id: string, patch: Record<string, unknown>) => Promise<void>; onDelete: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [findings, setFindings] = useState(visit.findings);
  const [nextSteps, setNextSteps] = useState(visit.next_steps);
  const [status, setStatus] = useState(visit.status);
  const [busy, setBusy] = useState(false);

  async function handleSave() {
    setBusy(true);
    try {
      await onUpdate(visit.id, { findings, nextSteps, status });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <tr>
        <td>
          <button type="button" className={historyStyles.toggleBtn} onClick={() => setExpanded((v) => !v)}>
            {expanded ? '−' : '+'}
          </button>
        </td>
        <td>{formatDate(visit.visit_date)}</td>
        <td>
          {visit.client_name}
          {visit.client_company ? ` (${visit.client_company})` : ''}
        </td>
        <td>{visit.status}</td>
        <td>{visit.next_steps || '-'}</td>
        <td>{visit.created_by}</td>
        <td>
          <button type="button" className={historyStyles.deleteBtn} onClick={() => onDelete(visit.id)}>
            Delete
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className={historyStyles.detailsRow}>
          <td colSpan={7}>
            <div className={`${calcStyles.row} ${calcStyles.columns}`}>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Address</label>
                <div className={calcStyles.small}>{visit.address || '-'}</div>
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Attendees</label>
                <div className={calcStyles.small}>{visit.attendees || '-'}</div>
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Linked quotation</label>
                <div className={calcStyles.small}>{visit.linked_quotation_number || '-'}</div>
              </div>
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Status</label>
              <select className={calcStyles.formControl} value={status} onChange={(e) => setStatus(e.target.value as SiteVisitRecord['status'])}>
                <option value="scheduled">Scheduled</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Findings</label>
              <textarea className={calcStyles.formControl} rows={3} value={findings} onChange={(e) => setFindings(e.target.value)} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Next steps</label>
              <textarea className={calcStyles.formControl} rows={2} value={nextSteps} onChange={(e) => setNextSteps(e.target.value)} />
            </div>
            <button type="button" className={calcStyles.btn} disabled={busy} onClick={handleSave}>
              {busy ? 'Saving…' : 'Save update'}
            </button>
          </td>
        </tr>
      )}
    </>
  );
}

function SiteVisitsContent() {
  const searchParams = useSearchParams();
  const [visits, setVisits] = useState<SiteVisitRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState('Loading...');
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [openOnly, setOpenOnly] = useState(searchParams.get('focus') === 'open');

  async function load() {
    setStatus('Loading...');
    try {
      const response = await fetch('/api/site-visits');
      if (!response.ok) throw new Error(String(response.status));
      const data: SiteVisitRecord[] = await response.json();
      setVisits(data);
      setStatus(data.length ? `${data.length} visit${data.length === 1 ? '' : 's'} found.` : '');
      setLoaded(true);
    } catch {
      setStatus('Could not reach the site visits API. Try refreshing.');
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleVisits = useMemo(() => (openOnly ? visits.filter((v) => v.status === 'scheduled') : visits), [visits, openOnly]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!form.clientName.trim() || !form.visitDate) {
      alert('Client name and visit date are required.');
      return;
    }
    setCreating(true);
    try {
      const response = await fetch('/api/site-visits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      if (!response.ok) throw new Error(String(response.status));
      setForm(EMPTY_FORM);
      await load();
    } catch {
      alert('Could not save this site visit. Please try again.');
    } finally {
      setCreating(false);
    }
  }

  async function handleUpdate(id: string, patch: Record<string, unknown>) {
    try {
      const response = await fetch(`/api/site-visits/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      });
      if (!response.ok) throw new Error(String(response.status));
      await load();
    } catch {
      alert('Could not save this update. Please try again.');
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this site visit report? This cannot be undone.')) return;
    try {
      const response = await fetch(`/api/site-visits/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(String(response.status));
      setVisits((prev) => prev.filter((v) => v.id !== id));
    } catch {
      alert('Could not delete this site visit.');
    }
  }

  return (
    <div className={historyStyles.body}>
      <PortalHeader title="Site Visit Reports" subtitle="Log client site visits and track findings and next steps." />
      <main className={historyStyles.main}>
        <h2 className={calcStyles.h2} style={{ marginTop: 0 }}>Log a site visit</h2>
        <form className={calcStyles.sectionPanel} onSubmit={handleCreate}>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Client name *</label>
              <input className={calcStyles.formControl} value={form.clientName} onChange={(e) => setForm((f) => ({ ...f, clientName: e.target.value }))} required />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Client company</label>
              <input className={calcStyles.formControl} value={form.clientCompany} onChange={(e) => setForm((f) => ({ ...f, clientCompany: e.target.value }))} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Visit date *</label>
              <input type="date" className={calcStyles.formControl} value={form.visitDate} onChange={(e) => setForm((f) => ({ ...f, visitDate: e.target.value }))} required />
            </div>
          </div>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Address</label>
              <input className={calcStyles.formControl} value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Attendees</label>
              <input className={calcStyles.formControl} value={form.attendees} onChange={(e) => setForm((f) => ({ ...f, attendees: e.target.value }))} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Linked quotation number</label>
              <input className={calcStyles.formControl} value={form.linkedQuotationNumber} onChange={(e) => setForm((f) => ({ ...f, linkedQuotationNumber: e.target.value }))} />
            </div>
          </div>
          <div className={calcStyles.field}>
            <label className={calcStyles.label}>Findings</label>
            <textarea className={calcStyles.formControl} rows={2} value={form.findings} onChange={(e) => setForm((f) => ({ ...f, findings: e.target.value }))} />
          </div>
          <div className={calcStyles.field}>
            <label className={calcStyles.label}>Next steps</label>
            <textarea className={calcStyles.formControl} rows={2} value={form.nextSteps} onChange={(e) => setForm((f) => ({ ...f, nextSteps: e.target.value }))} />
          </div>
          <button type="submit" className={calcStyles.btn} disabled={creating}>
            {creating ? 'Saving…' : 'Log site visit'}
          </button>
        </form>

        <div className={historyStyles.toolbar} style={{ marginTop: 24 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5 }}>
            <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />
            Scheduled (open) visits only
          </label>
          <button type="button" className={historyStyles.button} onClick={load}>
            Refresh
          </button>
        </div>
        <div className={historyStyles.status}>{status}</div>
        {loaded && (
          <table className={historyStyles.table}>
            <thead>
              <tr>
                <th></th>
                <th>Visit Date</th>
                <th>Client</th>
                <th>Status</th>
                <th>Next Steps</th>
                <th>Logged By</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visibleVisits.length === 0 ? (
                <tr>
                  <td colSpan={7} className={historyStyles.empty}>
                    No site visits recorded yet.
                  </td>
                </tr>
              ) : (
                visibleVisits.map((v) => <SiteVisitRow key={v.id} visit={v} onUpdate={handleUpdate} onDelete={handleDelete} />)
              )}
            </tbody>
          </table>
        )}
      </main>
    </div>
  );
}

export default function SiteVisitsView() {
  return (
    <Suspense fallback={<div className={historyStyles.body} />}>
      <SiteVisitsContent />
    </Suspense>
  );
}
