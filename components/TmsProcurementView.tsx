'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ShoppingCart } from 'lucide-react';
import { TmsProcurementRecord, TmsProjectRecord, TmsPurchaseStatus, UserRole } from '@/lib/types';
import { TMS_PURCHASE_STATUS_LABEL, TMS_PURCHASE_STATUS_TONE } from '@/lib/tmsLabels';
import AppShell from './AppShell';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import StatusBadge from './ui/StatusBadge';
import { useToast } from './ui/ToastProvider';
import { SkeletonRows } from './ui/Skeleton';
import EmptyState from './ui/EmptyState';
import ErrorState from './ui/ErrorState';

const EMPTY_FORM = { projectId: '', itemName: '', partNumber: '', quantity: '1', vendor: '', estimatedCost: '', requiredDate: '', remarks: '' };

interface TmsProcurementViewProps {
  currentUser: { username: string; role: UserRole };
}

export default function TmsProcurementView({ currentUser }: TmsProcurementViewProps) {
  void currentUser;
  const toast = useToast();
  const [records, setRecords] = useState<TmsProcurementRecord[]>([]);
  const [projects, setProjects] = useState<TmsProjectRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [status, setStatus] = useState('Loading...');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);

  const [fProject, setFProject] = useState('');
  const [fStatus, setFStatus] = useState<TmsPurchaseStatus | ''>('');
  const [fSearch, setFSearch] = useState('');

  async function load() {
    setStatus('Loading...');
    setLoading(true);
    setLoadFailed(false);
    try {
      const [recordsRes, projectsRes] = await Promise.all([fetch('/api/tms/procurement'), fetch('/api/tms/projects')]);
      if (!recordsRes.ok) throw new Error(String(recordsRes.status));
      const data: TmsProcurementRecord[] = await recordsRes.json();
      setRecords(data);
      if (projectsRes.ok) setProjects(await projectsRes.json());
      setStatus(data.length ? `${data.length} record${data.length === 1 ? '' : 's'} found.` : '');
    } catch {
      setStatus('Could not reach the TMS API. Try refreshing.');
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = fSearch.trim().toLowerCase();
    return records.filter((r) => {
      if (fProject && r.project_id !== fProject) return false;
      if (fStatus && r.purchase_status !== fStatus) return false;
      if (q && ![r.procurement_code, r.item_name, r.vendor].some((v) => (v || '').toLowerCase().includes(q))) return false;
      return true;
    });
  }, [records, fProject, fStatus, fSearch]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!form.projectId || !form.itemName.trim()) {
      toast.error('Project and item name are required.');
      return;
    }
    setCreating(true);
    try {
      const response = await fetch('/api/tms/procurement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, quantity: Number(form.quantity) || 1, estimatedCost: Number(form.estimatedCost) || 0 })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || String(response.status));
      }
      setForm(EMPTY_FORM);
      setShowForm(false);
      await load();
      toast.success('Procurement record created.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create this record.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <AppShell title="Procurement" subtitle="Purchase and delivery tracking from approved BOM requests.">
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        <button type="button" className={calcStyles.btn} onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Cancel' : '+ New Procurement Entry'}
        </button>
        <button type="button" className={historyStyles.button} onClick={load}>Refresh</button>
      </div>

      {showForm && (
        <form className={calcStyles.sectionPanel} onSubmit={handleCreate} style={{ marginBottom: 20 }}>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Project</label>
              <select className={calcStyles.formControl} value={form.projectId} onChange={(e) => setForm((f) => ({ ...f, projectId: e.target.value }))} required>
                <option value="">Select project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.project_code} — {p.name}</option>
                ))}
              </select>
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Item name</label>
              <input className={calcStyles.formControl} value={form.itemName} onChange={(e) => setForm((f) => ({ ...f, itemName: e.target.value }))} required />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Part number / Model</label>
              <input className={calcStyles.formControl} value={form.partNumber} onChange={(e) => setForm((f) => ({ ...f, partNumber: e.target.value }))} />
            </div>
          </div>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Quantity</label>
              <input type="number" min="1" className={calcStyles.formControl} value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Vendor / OEM</label>
              <input className={calcStyles.formControl} value={form.vendor} onChange={(e) => setForm((f) => ({ ...f, vendor: e.target.value }))} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Estimated cost</label>
              <input type="number" min="0" className={calcStyles.formControl} value={form.estimatedCost} onChange={(e) => setForm((f) => ({ ...f, estimatedCost: e.target.value }))} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Required date</label>
              <input type="date" className={calcStyles.formControl} value={form.requiredDate} onChange={(e) => setForm((f) => ({ ...f, requiredDate: e.target.value }))} />
            </div>
          </div>
          <div className={calcStyles.field}>
            <label className={calcStyles.label}>Remarks</label>
            <textarea className={calcStyles.formControl} rows={2} value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} />
          </div>
          <button type="submit" className={calcStyles.btn} disabled={creating}>
            {creating ? 'Creating…' : 'Create record'}
          </button>
        </form>
      )}

      <div className={historyStyles.toolbar}>
        <input type="text" placeholder="Search procurement code, item, vendor…" value={fSearch} onChange={(e) => setFSearch(e.target.value)} />
        <select className={calcStyles.formControl} style={{ width: 'auto' }} value={fProject} onChange={(e) => setFProject(e.target.value)}>
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <select className={calcStyles.formControl} style={{ width: 'auto' }} value={fStatus} onChange={(e) => setFStatus(e.target.value as TmsPurchaseStatus | '')}>
          <option value="">All purchase statuses</option>
          {(Object.keys(TMS_PURCHASE_STATUS_LABEL) as TmsPurchaseStatus[]).map((s) => (
            <option key={s} value={s}>{TMS_PURCHASE_STATUS_LABEL[s]}</option>
          ))}
        </select>
      </div>
      {!loading && !loadFailed && <div className={historyStyles.status}>{status}</div>}

      {loading ? (
        <div className={historyStyles.tableWrap}><SkeletonRows rows={8} columns={7} /></div>
      ) : loadFailed ? (
        <ErrorState message="Could not load procurement records — check your connection and try again." onRetry={load} />
      ) : (
        <table className={historyStyles.table}>
          <thead>
            <tr>
              <th>Procurement</th>
              <th>Project</th>
              <th>Item</th>
              <th>Vendor</th>
              <th>BOM Request</th>
              <th>Purchase Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <EmptyState
                    icon={ShoppingCart}
                    title={records.length === 0 ? 'No procurement records yet' : 'No records match your filters'}
                    message={records.length === 0 ? 'Approved BOM requests sent to procurement will appear here, or add one manually.' : 'Try clearing a filter or search term.'}
                  />
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.id}>
                  <td className={historyStyles.num}>{r.procurement_code}</td>
                  <td>{r.project_name}</td>
                  <td>{r.item_name}</td>
                  <td>{r.vendor || '-'}</td>
                  <td>{r.bom_request_code || '-'}</td>
                  <td><StatusBadge tone={TMS_PURCHASE_STATUS_TONE[r.purchase_status]} label={TMS_PURCHASE_STATUS_LABEL[r.purchase_status]} /></td>
                  <td><Link className={historyStyles.button} href={`/tms/procurement/${r.id}`}>View</Link></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
    </AppShell>
  );
}
