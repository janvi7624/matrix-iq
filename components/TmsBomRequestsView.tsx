'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { FileText } from 'lucide-react';
import { TmsBomRequestRecord, TmsBomRequestStatus, TmsProjectRecord, UserRole } from '@/lib/types';
import { TMS_BOM_STATUS_LABEL, TMS_BOM_STATUS_TONE } from '@/lib/tmsLabels';
import AppShell from './AppShell';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import StatusBadge from './ui/StatusBadge';
import { useToast } from './ui/ToastProvider';
import { SkeletonRows } from './ui/Skeleton';
import EmptyState from './ui/EmptyState';
import ErrorState from './ui/ErrorState';
import { Field, FieldRow } from './ui/Field';
import Input from './ui/Input';
import Select from './ui/Select';
import Textarea from './ui/Textarea';
import FilterBar from './ui/FilterBar';
import ToolbarButton from './ui/ToolbarButton';
import Table, { TableColumn } from './ui/Table';

const EMPTY_FORM = {
  projectId: '',
  itemName: '',
  itemDescription: '',
  partNumber: '',
  quantity: '1',
  specification: '',
  preferredBrand: '',
  estimatedCost: '',
  requiredDate: '',
  remarks: ''
};

interface TmsBomRequestsViewProps {
  currentUser: { username: string; role: UserRole };
}

export default function TmsBomRequestsView({ currentUser }: TmsBomRequestsViewProps) {
  void currentUser;
  const toast = useToast();
  const [records, setRecords] = useState<TmsBomRequestRecord[]>([]);
  const [projects, setProjects] = useState<TmsProjectRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [status, setStatus] = useState('Loading...');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);

  const [fProject, setFProject] = useState('');
  const [fStatus, setFStatus] = useState<TmsBomRequestStatus | ''>('');
  const [fSearch, setFSearch] = useState('');

  async function load() {
    setStatus('Loading...');
    setLoading(true);
    setLoadFailed(false);
    try {
      const [recordsRes, projectsRes] = await Promise.all([fetch('/api/tms/bom-requests'), fetch('/api/tms/projects')]);
      if (!recordsRes.ok) throw new Error(String(recordsRes.status));
      const data: TmsBomRequestRecord[] = await recordsRes.json();
      setRecords(data);
      if (projectsRes.ok) setProjects(await projectsRes.json());
      setStatus(data.length ? `${data.length} request${data.length === 1 ? '' : 's'} found.` : '');
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
      if (fStatus && r.status !== fStatus) return false;
      if (q && ![r.bom_request_code, r.item_name, r.part_number].some((v) => (v || '').toLowerCase().includes(q))) return false;
      return true;
    });
  }, [records, fProject, fStatus, fSearch]);

  async function handleCreate(e: FormEvent, submit: boolean) {
    e.preventDefault();
    if (!form.projectId || !form.itemName.trim()) {
      toast.error('Project and item name are required.');
      return;
    }
    setCreating(true);
    try {
      const response = await fetch('/api/tms/bom-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, quantity: Number(form.quantity) || 1, estimatedCost: Number(form.estimatedCost) || 0, submit })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || String(response.status));
      }
      setForm(EMPTY_FORM);
      setShowForm(false);
      await load();
      toast.success(submit ? 'BOM request submitted.' : 'BOM request saved as draft.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create this BOM request.');
    } finally {
      setCreating(false);
    }
  }

  const columns: TableColumn<TmsBomRequestRecord>[] = [
    { key: 'request', header: 'Request', cellClassName: historyStyles.num, render: (r) => r.bom_request_code },
    { key: 'project', header: 'Project', render: (r) => r.project_name },
    { key: 'item', header: 'Item', render: (r) => r.item_name },
    { key: 'qty', header: 'Qty', render: (r) => r.quantity },
    { key: 'requestedBy', header: 'Requested By', render: (r) => r.requested_by_name || '-' },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge tone={TMS_BOM_STATUS_TONE[r.status]} label={TMS_BOM_STATUS_LABEL[r.status]} /> },
    { key: 'actions', header: '', render: (r) => <Link className={historyStyles.button} href={`/tms/bom-requests/${r.id}`}>View</Link> }
  ];

  return (
    <AppShell title="BOM Request" subtitle="Bill of materials requests, review, and approval.">
      <div className={historyStyles.actionRow}>
        <button type="button" className={calcStyles.btn} onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Cancel' : '+ New BOM Request'}
        </button>
        <ToolbarButton onClick={load}>Refresh</ToolbarButton>
      </div>

      {showForm && (
        <form className={`${calcStyles.sectionPanel} ${calcStyles.sectionPanelSpaced}`}>
          <FieldRow>
            <Field label="Project">
              <Select value={form.projectId} onChange={(e) => setForm((f) => ({ ...f, projectId: e.target.value }))} required>
                <option value="">Select project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.project_code} — {p.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Item name">
              <Input value={form.itemName} onChange={(e) => setForm((f) => ({ ...f, itemName: e.target.value }))} required />
            </Field>
            <Field label="Part number / Model">
              <Input value={form.partNumber} onChange={(e) => setForm((f) => ({ ...f, partNumber: e.target.value }))} />
            </Field>
          </FieldRow>
          <FieldRow>
            <Field label="Quantity">
              <Input type="number" min="1" value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} />
            </Field>
            <Field label="Preferred brand / OEM">
              <Input value={form.preferredBrand} onChange={(e) => setForm((f) => ({ ...f, preferredBrand: e.target.value }))} />
            </Field>
            <Field label="Estimated cost">
              <Input type="number" min="0" value={form.estimatedCost} onChange={(e) => setForm((f) => ({ ...f, estimatedCost: e.target.value }))} />
            </Field>
            <Field label="Required date">
              <Input type="date" value={form.requiredDate} onChange={(e) => setForm((f) => ({ ...f, requiredDate: e.target.value }))} />
            </Field>
          </FieldRow>
          <Field label="Specification">
            <Textarea rows={2} value={form.specification} onChange={(e) => setForm((f) => ({ ...f, specification: e.target.value }))} />
          </Field>
          <Field label="Item description">
            <Textarea rows={2} value={form.itemDescription} onChange={(e) => setForm((f) => ({ ...f, itemDescription: e.target.value }))} />
          </Field>
          <Field label="Remarks">
            <Textarea rows={2} value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} />
          </Field>
          <div className={historyStyles.rowActionsInline}>
            <ToolbarButton disabled={creating} onClick={(e) => handleCreate(e, false)}>
              {creating ? 'Saving…' : 'Save as draft'}
            </ToolbarButton>
            <button type="button" className={calcStyles.btn} disabled={creating} onClick={(e) => handleCreate(e, true)}>
              {creating ? 'Submitting…' : 'Submit for review'}
            </button>
          </div>
        </form>
      )}

      <FilterBar>
        <input type="text" placeholder="Search request code, item, part number…" value={fSearch} onChange={(e) => setFSearch(e.target.value)} />
        <Select auto value={fProject} onChange={(e) => setFProject(e.target.value)}>
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </Select>
        <Select auto value={fStatus} onChange={(e) => setFStatus(e.target.value as TmsBomRequestStatus | '')}>
          <option value="">All statuses</option>
          {(Object.keys(TMS_BOM_STATUS_LABEL) as TmsBomRequestStatus[]).map((s) => (
            <option key={s} value={s}>{TMS_BOM_STATUS_LABEL[s]}</option>
          ))}
        </Select>
      </FilterBar>
      {!loading && !loadFailed && <div className={historyStyles.status}>{status}</div>}

      {loading ? (
        <div className={historyStyles.tableWrap}><SkeletonRows rows={8} columns={7} /></div>
      ) : loadFailed ? (
        <ErrorState message="Could not load BOM requests — check your connection and try again." onRetry={load} />
      ) : (
        <Table
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          empty={
            <EmptyState
              icon={FileText}
              title={records.length === 0 ? 'No BOM requests yet' : 'No requests match your filters'}
              message={records.length === 0 ? 'Create a request to start tracking material requirements.' : 'Try clearing a filter or search term.'}
            />
          }
        />
      )}
    </AppShell>
  );
}
