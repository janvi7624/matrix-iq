'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { UserRole, ReimbursementRecord, ReimbursementSheetRecord, ReimbursementSheetStatus } from '@/lib/types';
import { numberToIndianWords } from '@/lib/numberToWords';
import AppShell from './AppShell';
import { useToast } from './ui/ToastProvider';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';

interface Props {
  currentUser: { username: string; role: UserRole };
}

interface UserOption { id: string; username: string; name: string }

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const DESCRIPTION_OPTIONS = ['Lunch', 'Dinner', 'Snacks', 'Conveyance', 'Bus Ticket', 'Train Ticket', 'Flight Ticket', 'Hotel', 'Other'];

const TRAVEL_DESCRIPTIONS = new Set(['Conveyance', 'Bus Ticket', 'Train Ticket', 'Flight Ticket']);

const VEHICLE_RATE: Record<string, number> = { '2 Wheeler': 4, '4 Wheeler': 8, 'Cab': 0 };

const MODE_OPTIONS = ['Cash', 'UPI', 'Bank Transfer', 'Credit Card', 'Debit Card', 'Cheque', 'Other'];

const EMPTY_FORM = {
  date: '', description: '', descriptionType: '' as string, employeeIds: [] as string[],
  fromLocation: '', toLocation: '', kilometers: '',
  amount: '', modeOfPayment: '', attachmentUrls: [] as string[],
  vehicleType: '' as string,
};

const STATUS_CONFIG: Record<ReimbursementSheetStatus, { label: string; color: string; bg: string; step: number }> = {
  draft:                     { label: 'Draft',                    color: 'var(--mx-ink-muted)', bg: 'var(--mx-gray-100)', step: 0 },
  submitted:                 { label: 'Awaiting Manager Approval', color: 'var(--mx-amber-600)', bg: 'var(--mx-amber-50)', step: 1 },
  manager_approved:          { label: 'Manager Approved',         color: 'var(--mx-blue-600)', bg: 'var(--mx-blue-50)', step: 2 },
  manager_change_requested:  { label: 'Changes Requested (Manager)', color: 'var(--mx-brand)', bg: 'var(--mx-red-50)', step: 1 },
  hr_approved:               { label: 'HR Approved',              color: 'var(--mx-violet-600)', bg: 'var(--mx-violet-50)', step: 3 },
  hr_change_requested:       { label: 'Changes Requested (HR)',   color: 'var(--mx-brand)', bg: 'var(--mx-red-50)', step: 2 },
  payment_done:              { label: 'Payment Completed',        color: 'var(--mx-green-600)', bg: 'var(--mx-green-50)', step: 4 },
};

const STEPS = ['Employee', 'Manager', 'HR', 'Accounts'];

function formatDate(iso: string): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return iso; }
}

function friendlyFileName(url: string): string {
  const parts = url.split('/');
  const raw = decodeURIComponent(parts[parts.length - 1] || 'file');
  const match = raw.match(/^\d+-[a-f0-9]+-(.+)$/);
  return match?.[1] || raw;
}

function StepIndicator({ currentStep, status }: { currentStep: number; status: ReimbursementSheetStatus }) {
  const isChangeReq = status.includes('change_requested');
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, width: '100%', maxWidth: 520, margin: '12px 0' }}>
      {STEPS.map((label, i) => {
        const done = i < currentStep;
        const active = i === currentStep;
        const rejected = isChangeReq && active;
        let dotColor = 'var(--mx-border-strong)';
        let dotBg = 'var(--mx-surface)';
        if (done) { dotColor = 'var(--mx-green-600)'; dotBg = 'var(--mx-green-600)'; }
        else if (rejected) { dotColor = 'var(--mx-brand)'; dotBg = 'var(--mx-brand)'; }
        else if (active) { dotColor = 'var(--mx-blue-600)'; dotBg = 'var(--mx-blue-600)'; }

        return (
          <div key={label} style={{ display: 'flex', alignItems: 'center', flex: i < STEPS.length - 1 ? 1 : 'none' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 56 }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%', border: `2px solid ${dotColor}`, background: dotBg,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700,
                color: done || active || rejected ? 'var(--mx-surface)' : 'var(--mx-ink-faint)',
                transition: 'all 0.2s ease',
              }}>
                {done ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--mx-surface)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                ) : rejected ? '!' : (i + 1)}
              </div>
              <span style={{ fontSize: '10.5px', fontWeight: active || done ? 700 : 500, color: active ? dotColor : 'var(--mx-ink-faint)', marginTop: 4, whiteSpace: 'nowrap' }}>{label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div style={{ flex: 1, height: 2, background: done ? 'var(--mx-green-600)' : 'var(--mx-border-strong)', margin: '0 4px', marginBottom: 18, transition: 'background 0.2s ease' }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function ReimbursementView({ currentUser }: Props) {
  const now = useMemo(() => new Date(), []);
  const toast = useToast();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [records, setRecords] = useState<ReimbursementRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [totalInWords, setTotalInWords] = useState('');
  const [users, setUsers] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const [sheet, setSheet] = useState<ReimbursementSheetRecord | null>(null);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionRemarks, setActionRemarks] = useState('');
  const [paymentRef, setPaymentRef] = useState('');

  const [tab, setTab] = useState<'my' | 'pending' | 'approved'>('my');
  const [pendingSheets, setPendingSheets] = useState<ReimbursementSheetRecord[]>([]);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [selectedPending, setSelectedPending] = useState<ReimbursementSheetRecord | null>(null);
  const [pendingRecords, setPendingRecords] = useState<ReimbursementRecord[]>([]);
  const [pendingTotal, setPendingTotal] = useState(0);
  const [pendingTotalInWords, setPendingTotalInWords] = useState('');
  const [pendingAdminRecords, setPendingAdminRecords] = useState<ReimbursementRecord[]>([]);
  const [pendingAdminTotal, setPendingAdminTotal] = useState(0);
  const [pendingDetailLoading, setPendingDetailLoading] = useState(false);

  const [approvedSheets, setApprovedSheets] = useState<ReimbursementSheetRecord[]>([]);
  const [approvedLoading, setApprovedLoading] = useState(false);
  const [selectedApproved, setSelectedApproved] = useState<ReimbursementSheetRecord | null>(null);
  const [approvedRecords, setApprovedRecords] = useState<ReimbursementRecord[]>([]);
  const [approvedTotal, setApprovedTotal] = useState(0);
  const [approvedAdminRecords, setApprovedAdminRecords] = useState<ReimbursementRecord[]>([]);
  const [approvedAdminTotal, setApprovedAdminTotal] = useState(0);
  const [approvedTotalInWords, setApprovedTotalInWords] = useState('');
  const [approvedDetailLoading, setApprovedDetailLoading] = useState(false);

  const [editingAmountId, setEditingAmountId] = useState<string | null>(null);
  const [editingAmountValue, setEditingAmountValue] = useState('');
  const [editingAmountLoading, setEditingAmountLoading] = useState(false);

  const isPrivileged = ['superadmin', 'admin', 'manager'].includes(currentUser.role);
  const isHr = currentUser.role === 'hr';
  const canSeeAdminEntries = ['superadmin', 'admin', 'hr', 'accounts'].includes(currentUser.role);
  const myUserId = useMemo(() => users.find((u) => u.username === currentUser.username)?.id || '', [users, currentUser.username]);

  const sheetStatus = sheet?.status || 'draft';
  const canEdit = ['draft', 'manager_change_requested', 'hr_change_requested'].includes(sheetStatus);

  const fetchRecords = useCallback(() => {
    setLoading(true);
    fetch(`/api/reimbursement?year=${year}&month=${month}&own=true`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) {
          setRecords(data.records ?? []);
          setTotal(data.total ?? 0);
          setTotalInWords(data.totalInWords ?? '');
        }
      })
      .finally(() => setLoading(false));
  }, [year, month]);

  const fetchSheet = useCallback(() => {
    setSheetLoading(true);
    fetch(`/api/reimbursement/sheet?year=${year}&month=${month}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data?.id) setSheet(data); else setSheet(null); })
      .finally(() => setSheetLoading(false));
  }, [year, month]);

  useEffect(() => { fetchRecords(); fetchSheet(); }, [fetchRecords, fetchSheet]);

  useEffect(() => {
    fetch('/api/users/lite').then((r) => r.ok ? r.json() : []).then((data) => setUsers(Array.isArray(data) ? data : []));
  }, []);

  const fetchPending = useCallback(() => {
    setPendingLoading(true);
    fetch('/api/reimbursement/sheet/pending')
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data?.sheets) setPendingSheets(data.sheets); })
      .finally(() => setPendingLoading(false));
  }, []);

  useEffect(() => { if (isPrivileged) fetchPending(); }, [fetchPending, isPrivileged]);
  useEffect(() => { if (isPrivileged && tab === 'pending') fetchPending(); }, [tab, fetchPending, isPrivileged]);

  function openPendingSheet(s: ReimbursementSheetRecord) {
    setSelectedPending(s);
    setPendingDetailLoading(true);
    setPendingRecords([]);
    setPendingAdminRecords([]);
    setPendingAdminTotal(0);
    setActionRemarks('');
    setPaymentRef('');
    fetch(`/api/reimbursement/sheet/${s.id}/entries`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) {
          setPendingRecords(data.records ?? []);
          setPendingTotal(data.total ?? 0);
          setPendingTotalInWords(data.totalInWords ?? '');
          setPendingAdminRecords(data.adminRecords ?? []);
          setPendingAdminTotal(data.adminTotal ?? 0);
          if (data.sheet) setSelectedPending(data.sheet);
        }
      })
      .finally(() => setPendingDetailLoading(false));
  }

  const fetchApproved = useCallback(() => {
    setApprovedLoading(true);
    fetch('/api/reimbursement/sheet/approved')
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data?.sheets) setApprovedSheets(data.sheets); })
      .finally(() => setApprovedLoading(false));
  }, []);

  useEffect(() => { if (tab === 'approved') fetchApproved(); }, [tab, fetchApproved]);

  function openApprovedSheet(s: ReimbursementSheetRecord) {
    setSelectedApproved(s);
    setApprovedDetailLoading(true);
    setApprovedRecords([]);
    setApprovedAdminRecords([]);
    setApprovedAdminTotal(0);
    fetch(`/api/reimbursement/sheet/${s.id}/entries`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) {
          setApprovedRecords(data.records ?? []);
          setApprovedTotal(data.total ?? 0);
          setApprovedTotalInWords(data.totalInWords ?? '');
          setApprovedAdminRecords(data.adminRecords ?? []);
          setApprovedAdminTotal(data.adminTotal ?? 0);
          if (data.sheet) setSelectedApproved(data.sheet);
        }
      })
      .finally(() => setApprovedDetailLoading(false));
  }

  async function handlePendingAction(endpoint: string, body: Record<string, unknown>) {
    if (!selectedPending) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/reimbursement/sheet/${selectedPending.id}/${endpoint}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) { toast.error(data?.error || 'Action failed.'); return; }
      toast.success('Action completed.');
      setSelectedPending(null);
      setPendingRecords([]);
      setActionRemarks('');
      setPaymentRef('');
      fetchPending();
    } finally {
      setActionLoading(false);
    }
  }

  const dateMin = `${year}-${String(month).padStart(2, '0')}-01`;
  const dateMax = `${year}-${String(month).padStart(2, '0')}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`;

  const amountInWords = useMemo(() => {
    const n = Number(form.amount);
    return n > 0 ? numberToIndianWords(n) : '';
  }, [form.amount]);

  async function handleUpload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('folder', 'reimbursement');
      for (let i = 0; i < files.length; i++) fd.append('files', files[i]);
      const res = await fetch('/api/uploads', { method: 'POST', body: fd });
      const data = await res.json().catch(() => null);
      if (!res.ok) { toast.error(data?.error || 'Upload failed. Please try again.'); return; }
      if (data?.urls) setForm((f) => ({ ...f, attachmentUrls: [...f.attachmentUrls, ...data.urls] }));
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.date || !form.descriptionType || !form.amount) { toast.error('Date, description and amount are required.'); return; }
    if (form.descriptionType === 'Other' && !form.description.trim()) { toast.error('Please enter the description for "Other".'); return; }
    if (form.descriptionType === 'Conveyance' && !form.vehicleType) { toast.error('Please select vehicle type (2 Wheeler or 4 Wheeler).'); return; }
    if (form.descriptionType === 'Conveyance' && (!form.fromLocation.trim() || !form.toLocation.trim())) { toast.error('From and To are required for Conveyance.'); return; }
    if (form.descriptionType === 'Conveyance' && form.vehicleType !== 'Cab' && !form.kilometers) { toast.error('Kilometers is required for 2 Wheeler / 4 Wheeler.'); return; }
    if (!form.employeeIds.length) { toast.error('Please select at least one employee.'); return; }
    const attachmentOptional = form.descriptionType === 'Conveyance' && (form.vehicleType === '2 Wheeler' || form.vehicleType === '4 Wheeler');
    if (!attachmentOptional && !form.attachmentUrls.length) { toast.error('Please attach at least one bill proof.'); return; }

    const fullDescription = form.descriptionType === 'Conveyance' && form.vehicleType
      ? `Conveyance (${form.vehicleType})`
      : form.descriptionType === 'Other'
        ? form.description.trim()
        : form.descriptionType;

    setSaving(true);
    try {
      const payload = {
        date: form.date,
        description: fullDescription,
        employeeIds: form.employeeIds,
        fromLocation: form.fromLocation,
        toLocation: form.toLocation,
        kilometers: Number(form.kilometers) || 0,
        amount: Number(form.amount),
        modeOfPayment: form.modeOfPayment,
        attachmentUrls: form.attachmentUrls
      };

      const url = editId ? `/api/reimbursement/${editId}` : '/api/reimbursement';
      const method = editId ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const resData = await res.json().catch(() => null);
      if (!res.ok) { toast.error(resData?.error || 'Could not save. Please try again.'); return; }
      toast.success(editId ? 'Entry updated.' : 'Entry added.');
      setForm({ ...EMPTY_FORM });
      setEditId(null);
      setShowForm(false);
      fetchRecords();
      fetchSheet();
    } finally {
      setSaving(false);
    }
  }

  function startEdit(rec: ReimbursementRecord) {
    if (!canEdit) { toast.error('Cannot edit — sheet has been submitted for approval.'); return; }
    const vehicleMatch = rec.description.match(/^Conveyance \((2 Wheeler|4 Wheeler)\)$/);
    let descType: string;
    let vehicle = '';
    if (vehicleMatch) { descType = 'Conveyance'; vehicle = vehicleMatch[1]; }
    else { const knownType = DESCRIPTION_OPTIONS.find((o) => o !== 'Other' && rec.description === o); descType = knownType || (rec.description ? 'Other' : ''); }
    setForm({
      date: rec.date,
      descriptionType: descType,
      description: descType && descType !== 'Other' ? '' : rec.description,
      employeeIds: rec.employee_ids,
      fromLocation: rec.from_location,
      toLocation: rec.to_location,
      kilometers: rec.kilometers ? String(rec.kilometers) : '',
      amount: String(rec.amount),
      modeOfPayment: rec.mode_of_payment,
      attachmentUrls: rec.attachment_urls,
      vehicleType: vehicle,
    });
    setEditId(rec.id);
    setShowForm(true);
  }

  async function handleDelete(id: string) {
    if (!canEdit) { toast.error('Cannot delete — sheet has been submitted for approval.'); return; }
    if (!confirm('Delete this reimbursement entry?')) return;
    const res = await fetch(`/api/reimbursement/${id}`, { method: 'DELETE' });
    if (res.ok) { toast.success('Entry deleted.'); fetchRecords(); fetchSheet(); }
    else toast.error('Could not delete.');
  }

  function cancelForm() {
    setForm({ ...EMPTY_FORM });
    setEditId(null);
    setShowForm(false);
  }

  async function downloadVoucher(sheetId: string) {
    try {
      const res = await fetch(`/api/reimbursement/sheet/${sheetId}/voucher`);
      if (!res.ok) { toast.error('Failed to load voucher data.'); return; }
      const data = await res.json();
      if (!data.records?.length) { toast.error('No entries to export.'); return; }
      const { generateExpenseVoucherXlsx } = await import('@/lib/expenseVoucherXlsx');
      await generateExpenseVoucherXlsx(data);
      toast.success('Expense Voucher downloaded.');
    } catch (error) {
      console.error('Voucher export error:', error);
      toast.error('Failed to export voucher.');
    }
  }

  async function handleHrAmountEdit(recId: string) {
    const amt = Number(editingAmountValue);
    if (!amt || amt <= 0) { toast.error('Enter a valid amount.'); return; }
    setEditingAmountLoading(true);
    try {
      const res = await fetch(`/api/reimbursement/${recId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: amt }),
      });
      if (!res.ok) { const e = await res.json().catch(() => null); toast.error(e?.error || 'Failed to update amount.'); return; }
      toast.success('Amount updated.');
      setEditingAmountId(null);
      if (selectedPending) openPendingSheet(selectedPending);
    } catch { toast.error('Failed to update amount.'); }
    finally { setEditingAmountLoading(false); }
  }

  async function handleSheetAction(endpoint: string, body: Record<string, unknown>) {
    if (!sheet) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/reimbursement/sheet/${sheet.id}/${endpoint}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) { toast.error(data?.error || 'Action failed.'); return; }
      toast.success('Action completed.');
      setSheet(data);
      setActionRemarks('');
      setPaymentRef('');
    } finally {
      setActionLoading(false);
    }
  }

  const statusCfg = STATUS_CONFIG[sheetStatus] || STATUS_CONFIG.draft;

  return (
    <AppShell title="Reimbursement" subtitle="Submit and track monthly expense reimbursement bills.">
      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid var(--mx-border-strong)', marginBottom: 16 }}>
        <button type="button" onClick={() => { setTab('my'); setSelectedPending(null); }} style={{
          padding: '10px 24px', fontSize: '13.5px', fontWeight: tab === 'my' ? 700 : 500, cursor: 'pointer',
          background: 'none', border: 'none', borderBottom: tab === 'my' ? '2px solid var(--mx-brand)' : '2px solid transparent',
          color: tab === 'my' ? 'var(--mx-brand)' : 'var(--mx-ink-muted)', marginBottom: -2,
        }}>
          My Sheet
        </button>
        {isPrivileged && (
          <button type="button" onClick={() => setTab('pending')} style={{
            padding: '10px 24px', fontSize: '13.5px', fontWeight: tab === 'pending' ? 700 : 500, cursor: 'pointer',
            background: 'none', border: 'none', borderBottom: tab === 'pending' ? '2px solid var(--mx-brand)' : '2px solid transparent',
            color: tab === 'pending' ? 'var(--mx-brand)' : 'var(--mx-ink-muted)', marginBottom: -2,
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
            Pending Approvals
            {pendingSheets.length > 0 && (
              <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 20, height: 20, borderRadius: 10, background: 'var(--mx-brand)', color: 'var(--mx-surface)', fontSize: '11px', fontWeight: 700, padding: '0 6px' }}>
                {pendingSheets.length}
              </span>
            )}
          </button>
        )}
        {isPrivileged && (
          <button type="button" onClick={() => setTab('approved')} style={{
            padding: '10px 24px', fontSize: '13.5px', fontWeight: tab === 'approved' ? 700 : 500, cursor: 'pointer',
            background: 'none', border: 'none', borderBottom: tab === 'approved' ? '2px solid var(--mx-brand)' : '2px solid transparent',
            color: tab === 'approved' ? 'var(--mx-brand)' : 'var(--mx-ink-muted)', marginBottom: -2,
          }}>
            Approved
          </button>
        )}
      </div>

      {tab === 'my' && (
        <>
      {/* Toolbar */}
      <div className={historyStyles.toolbar}>
        <select className={calcStyles.formControl} style={{ width: 160 }} value={month} onChange={(e) => { setMonth(Number(e.target.value)); setForm((f) => ({ ...f, date: '' })); }}>
          {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>
        <select className={calcStyles.formControl} style={{ width: 100 }} value={year} onChange={(e) => { setYear(Number(e.target.value)); setForm((f) => ({ ...f, date: '' })); }}>
          {Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i).map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        {canEdit && (
          <button type="button" className={`${historyStyles.button} ${historyStyles.primary}`} onClick={() => { setShowForm((v) => !v); if (showForm) cancelForm(); else { setEditId(null); setForm({ ...EMPTY_FORM, employeeIds: myUserId ? [myUserId] : [] }); } }}>
            {showForm ? 'Cancel' : '+ Add Entry'}
          </button>
        )}
        <button type="button" className={historyStyles.button} onClick={() => { fetchRecords(); fetchSheet(); }}>Refresh</button>
        {records.length > 0 && (
          <button type="button" className={historyStyles.button} onClick={() => sheet && downloadVoucher(sheet.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Export Voucher
          </button>
        )}
      </div>

      {/* Sheet status card */}
      {sheet && !sheetLoading && (
        <div style={{
          margin: '16px 0', padding: '16px 20px', borderRadius: 'var(--mx-radius-sm, 10px)',
          border: `1px solid ${statusCfg.color}33`, background: statusCfg.bg,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--mx-ink)', marginBottom: 2 }}>
                {sheet.sheet_code}
              </div>
              <div style={{ fontSize: '12.5px', color: 'var(--mx-ink-muted)' }}>
                {sheet.creator_name} {sheet.creator_employee_id ? `(${sheet.creator_employee_id})` : ''} &middot; {MONTHS[sheet.month - 1]} {sheet.year}
              </div>
            </div>
            <span style={{
              display: 'inline-block', padding: '4px 14px', borderRadius: 20,
              background: statusCfg.color, color: 'var(--mx-surface)', fontSize: '12px', fontWeight: 700,
              letterSpacing: '0.02em',
            }}>
              {statusCfg.label}
            </span>
          </div>

          <StepIndicator currentStep={statusCfg.step} status={sheetStatus} />

          {/* Change request remarks */}
          {sheet.change_request_remarks && (sheetStatus === 'manager_change_requested' || sheetStatus === 'hr_change_requested') && (
            <div style={{
              marginTop: 8, padding: '10px 14px', borderRadius: 'var(--mx-radius-xs, 6px)',
              background: 'var(--mx-red-50)', border: '1px solid var(--mx-red-200)', fontSize: '13px', color: 'var(--mx-red-800)',
            }}>
              <strong>Changes requested{sheet.change_requested_by ? ` by ${sheet.change_requested_by}` : ''}:</strong> {sheet.change_request_remarks}
            </div>
          )}

          {/* Employee: Submit button */}
          {canEdit && sheet.created_by === currentUser.username && records.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <button
                type="button"
                className={`${historyStyles.button} ${historyStyles.primary}`}
                disabled={actionLoading}
                onClick={() => handleSheetAction('submit', {})}
                style={{ fontSize: '13px', padding: '8px 24px' }}
              >
                {actionLoading ? 'Submitting…' : 'Submit to Manager for Approval'}
              </button>
              {sheetStatus === 'draft' && (
                <span style={{ marginLeft: 12, fontSize: '12px', color: 'var(--mx-ink-faint)' }}>
                  This will send your {MONTHS[sheet.month - 1]} sheet (₹{total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}) to your department manager.
                </span>
              )}
            </div>
          )}

          {/* Manager: Approve / Request Changes */}
          {sheetStatus === 'submitted' && sheet.created_by !== currentUser.username && (
            <div style={{ marginTop: 14, padding: '14px 16px', background: 'var(--mx-surface)', borderRadius: 'var(--mx-radius-xs, 8px)', border: '1px solid var(--mx-border-strong)' }}>
              <div style={{ fontSize: '13.5px', fontWeight: 700, marginBottom: 8, color: 'var(--mx-ink)' }}>Manager Decision</div>
              <div style={{ fontSize: '12.5px', color: 'var(--mx-ink-muted)', marginBottom: 10 }}>
                Review {sheet.creator_name}&apos;s reimbursement for {MONTHS[sheet.month - 1]} {sheet.year} — {sheet.entry_count} entries totaling ₹{sheet.total_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </div>
              <textarea
                className={calcStyles.formControl}
                rows={2}
                placeholder="Remarks (optional)"
                value={actionRemarks}
                onChange={(e) => setActionRemarks(e.target.value)}
                style={{ marginBottom: 10, width: '100%' }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className={`${historyStyles.button} ${historyStyles.primary}`}
                  disabled={actionLoading}
                  onClick={() => handleSheetAction('manager-decide', { decision: 'manager_approved', remarks: actionRemarks })}
                  style={{ background: 'var(--mx-green-600)', borderColor: 'var(--mx-green-600)' }}
                >
                  {actionLoading ? 'Processing…' : 'Approve'}
                </button>
                <button
                  type="button"
                  className={historyStyles.button}
                  disabled={actionLoading}
                  onClick={() => {
                    if (!actionRemarks.trim()) { toast.error('Please provide remarks for the change request.'); return; }
                    handleSheetAction('manager-decide', { decision: 'manager_change_requested', remarks: actionRemarks });
                  }}
                  style={{ color: 'var(--mx-brand)', borderColor: 'var(--mx-brand)' }}
                >
                  Request Changes
                </button>
              </div>
            </div>
          )}

          {/* HR: Approve / Request Changes */}
          {sheetStatus === 'manager_approved' && sheet.created_by !== currentUser.username && (
            <div style={{ marginTop: 14, padding: '14px 16px', background: 'var(--mx-surface)', borderRadius: 'var(--mx-radius-xs, 8px)', border: '1px solid var(--mx-border-strong)' }}>
              <div style={{ fontSize: '13.5px', fontWeight: 700, marginBottom: 8, color: 'var(--mx-ink)' }}>HR Review</div>
              <div style={{ fontSize: '12.5px', color: 'var(--mx-ink-muted)', marginBottom: 4 }}>
                {sheet.creator_name} ({sheet.creator_employee_id}) &middot; {MONTHS[sheet.month - 1]} {sheet.year} &middot; {sheet.entry_count} entries &middot; ₹{sheet.total_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </div>
              {sheet.manager_name && (
                <div style={{ fontSize: '12px', color: 'var(--mx-ink-faint)', marginBottom: 10 }}>
                  Approved by Manager: {sheet.manager_name} {sheet.manager_action_at ? `on ${formatDate(sheet.manager_action_at)}` : ''}
                  {sheet.manager_remarks ? ` — "${sheet.manager_remarks}"` : ''}
                </div>
              )}
              <textarea
                className={calcStyles.formControl}
                rows={2}
                placeholder="Remarks (optional)"
                value={actionRemarks}
                onChange={(e) => setActionRemarks(e.target.value)}
                style={{ marginBottom: 10, width: '100%' }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className={`${historyStyles.button} ${historyStyles.primary}`}
                  disabled={actionLoading}
                  onClick={() => handleSheetAction('hr-decide', { decision: 'hr_approved', remarks: actionRemarks })}
                  style={{ background: 'var(--mx-green-600)', borderColor: 'var(--mx-green-600)' }}
                >
                  {actionLoading ? 'Processing…' : 'Approve & Forward to Accounts'}
                </button>
                <button
                  type="button"
                  className={historyStyles.button}
                  disabled={actionLoading}
                  onClick={() => {
                    if (!actionRemarks.trim()) { toast.error('Please provide remarks for the change request.'); return; }
                    handleSheetAction('hr-decide', { decision: 'hr_change_requested', remarks: actionRemarks });
                  }}
                  style={{ color: 'var(--mx-brand)', borderColor: 'var(--mx-brand)' }}
                >
                  Request Changes
                </button>
              </div>
            </div>
          )}

          {/* Accounts: Mark Payment Done */}
          {sheetStatus === 'hr_approved' && sheet.created_by !== currentUser.username && (
            <div style={{ marginTop: 14, padding: '14px 16px', background: 'var(--mx-surface)', borderRadius: 'var(--mx-radius-xs, 8px)', border: '1px solid var(--mx-border-strong)' }}>
              <div style={{ fontSize: '13.5px', fontWeight: 700, marginBottom: 8, color: 'var(--mx-ink)' }}>Accounts — Process Payment</div>
              <div style={{ fontSize: '12.5px', color: 'var(--mx-ink-muted)', marginBottom: 10 }}>
                {sheet.creator_name} ({sheet.creator_employee_id}) &middot; {MONTHS[sheet.month - 1]} {sheet.year} &middot; ₹{sheet.total_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })} ({sheet.total_in_words})
              </div>
              <div className={`${calcStyles.row} ${calcStyles.columns}`} style={{ marginBottom: 10 }}>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Payment Reference</label>
                  <input type="text" className={calcStyles.formControl} value={paymentRef} onChange={(e) => setPaymentRef(e.target.value)} placeholder="Transaction ID / UTR / Cheque No." />
                </div>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Remarks</label>
                  <input type="text" className={calcStyles.formControl} value={actionRemarks} onChange={(e) => setActionRemarks(e.target.value)} placeholder="Optional remarks" />
                </div>
              </div>
              <button
                type="button"
                className={`${historyStyles.button} ${historyStyles.primary}`}
                disabled={actionLoading}
                onClick={() => handleSheetAction('accounts-complete', { paymentReference: paymentRef, remarks: actionRemarks })}
                style={{ background: 'var(--mx-green-600)', borderColor: 'var(--mx-green-600)' }}
              >
                {actionLoading ? 'Processing…' : 'Mark Payment Done'}
              </button>
            </div>
          )}

          {/* Payment done summary */}
          {sheetStatus === 'payment_done' && (
            <div style={{ marginTop: 10, fontSize: '13px', color: 'var(--mx-green-600)', fontWeight: 600 }}>
              Payment completed{sheet.accounts_handler_name ? ` by ${sheet.accounts_handler_name}` : ''}{sheet.accounts_completed_at ? ` on ${formatDate(sheet.accounts_completed_at)}` : ''}
              {sheet.payment_reference ? ` — Ref: ${sheet.payment_reference}` : ''}
            </div>
          )}
        </div>
      )}

      {/* Add / Edit form */}
      {showForm && canEdit && (
        <>
          <h2 className={calcStyles.h2} style={{ marginTop: 16 }}>{editId ? 'Edit Entry' : 'New Reimbursement Entry'}</h2>
          <form className={calcStyles.sectionPanel} onSubmit={handleSubmit}>
            <div className={`${calcStyles.row} ${calcStyles.columns}`}>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Date *</label>
                <input type="date" className={calcStyles.formControl} required min={dateMin} max={dateMax} value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Description *</label>
                <select className={calcStyles.formControl} required value={form.descriptionType} onChange={(e) => {
                  const val = e.target.value;
                  setForm((f) => ({
                    ...f, descriptionType: val, description: '', vehicleType: '',
                    ...(val !== f.descriptionType ? { fromLocation: '', toLocation: '', kilometers: '', amount: '' } : {}),
                  }));
                }}>
                  <option value="">— Select type —</option>
                  {DESCRIPTION_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
                {form.descriptionType === 'Other' && (
                  <input type="text" className={calcStyles.formControl} required value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Enter description" style={{ marginTop: 6 }} />
                )}
                {form.descriptionType === 'Conveyance' && (
                  <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--mx-gray-700)' }}>Vehicle Type *</span>
                  </div>
                  <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
                    {Object.keys(VEHICLE_RATE).map((v) => (
                      <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, fontWeight: form.vehicleType === v ? 700 : 500, color: form.vehicleType === v ? 'var(--mx-brand)' : 'var(--mx-gray-700)', padding: '6px 12px', borderRadius: 'var(--mx-radius-sm)', border: form.vehicleType === v ? '2px solid var(--mx-brand)' : '1px solid var(--mx-border)', background: form.vehicleType === v ? 'var(--mx-brand-subtle)' : 'var(--mx-surface)', transition: 'all 0.15s ease' }}>
                        <input type="radio" name="vehicleType" value={v} checked={form.vehicleType === v} style={{ display: 'none' }} onChange={() => {
                          setForm((f) => {
                            const km = Number(f.kilometers) || 0;
                            const rate = VEHICLE_RATE[v];
                            const isCab = v === 'Cab';
                            return { ...f, vehicleType: v, amount: isCab ? '' : (km > 0 && rate > 0 ? String(km * rate) : ''), kilometers: isCab ? '' : f.kilometers };
                          });
                        }} />
                        {v}{VEHICLE_RATE[v] > 0 ? ` (₹${VEHICLE_RATE[v]}/km)` : ''}
                      </label>
                    ))}
                  </div>
                  </>
                )}
              </div>
            </div>

            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Employee(s) *</label>
              {form.employeeIds.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                  {form.employeeIds.map((id) => {
                    const user = users.find((u) => u.id === id);
                    const isMe = id === myUserId;
                    return (
                      <span key={id} className={historyStyles.rolePill} style={{ background: isMe ? 'var(--mx-brand-subtle)' : 'var(--mx-info-subtle)', color: isMe ? 'var(--mx-brand)' : 'var(--mx-info)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        {user?.name || user?.username || id}{isMe ? ' (You)' : ''}
                        {!isMe && (
                          <button type="button" onClick={() => setForm((f) => ({ ...f, employeeIds: f.employeeIds.filter((c) => c !== id) }))} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: '1rem', lineHeight: 1, color: 'inherit', opacity: 0.7 }}>&times;</button>
                        )}
                      </span>
                    );
                  })}
                </div>
              )}
              <select
                className={calcStyles.formControl}
                onChange={(e) => {
                  const id = e.target.value;
                  if (id && !form.employeeIds.includes(id)) setForm((f) => ({ ...f, employeeIds: [...f.employeeIds, id] }));
                  e.target.value = '';
                }}
              >
                <option value="">— Add companion (optional) —</option>
                {users.filter((u) => !form.employeeIds.includes(u.id)).map((u) => (
                  <option key={u.id} value={u.id}>{u.name || u.username}</option>
                ))}
              </select>
            </div>

            {TRAVEL_DESCRIPTIONS.has(form.descriptionType) && (
              <div className={`${calcStyles.row} ${calcStyles.columns}`}>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>From{form.descriptionType === 'Conveyance' ? ' *' : ''}</label>
                  <input type="text" className={calcStyles.formControl} required={form.descriptionType === 'Conveyance'} value={form.fromLocation} onChange={(e) => setForm((f) => ({ ...f, fromLocation: e.target.value }))} placeholder="Origin location" />
                </div>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>To{form.descriptionType === 'Conveyance' ? ' *' : ''}</label>
                  <input type="text" className={calcStyles.formControl} required={form.descriptionType === 'Conveyance'} value={form.toLocation} onChange={(e) => setForm((f) => ({ ...f, toLocation: e.target.value }))} placeholder="Destination location" />
                </div>
                {form.descriptionType === 'Conveyance' && form.vehicleType !== 'Cab' && (
                  <div className={calcStyles.field}>
                    <label className={calcStyles.label}>Kilometers *</label>
                    <input type="text" inputMode="decimal" className={calcStyles.formControl} required value={form.kilometers} onChange={(e) => {
                      const v = e.target.value;
                      if (v !== '' && !/^\d*\.?\d*$/.test(v)) return;
                      setForm((f) => {
                        const km = Number(v) || 0;
                        const rate = VEHICLE_RATE[f.vehicleType] || 0;
                        const autoAmount = f.vehicleType && km > 0 ? String(km * rate) : f.amount;
                        return { ...f, kilometers: v, amount: autoAmount };
                      });
                    }} placeholder="e.g. 12.5" />
                  </div>
                )}
              </div>
            )}

            <div className={`${calcStyles.row} ${calcStyles.columns}`}>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Amount (₹) *{form.descriptionType === 'Conveyance' && form.vehicleType && form.vehicleType !== 'Cab' ? ` — ${form.vehicleType} @ ₹${VEHICLE_RATE[form.vehicleType]}/km` : ''}</label>
                <input type="number" className={calcStyles.formControl} required value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} min="0.01" step="0.01" placeholder="0.00" readOnly={form.descriptionType === 'Conveyance' && !!form.vehicleType && form.vehicleType !== 'Cab'} style={form.descriptionType === 'Conveyance' && form.vehicleType && form.vehicleType !== 'Cab' ? { background: 'var(--mx-surface-sunken)', cursor: 'not-allowed' } : undefined} />
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Mode of Payment</label>
                <select className={calcStyles.formControl} value={form.modeOfPayment} onChange={(e) => setForm((f) => ({ ...f, modeOfPayment: e.target.value }))}>
                  <option value="">— Select —</option>
                  {MODE_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>

            {amountInWords && (
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Amount in Words</label>
                <div style={{ padding: '8px 12px', background: 'var(--mx-surface-sunken)', borderRadius: 'var(--mx-radius-xs)', fontSize: '13px', fontStyle: 'italic', color: 'var(--mx-ink-muted)' }}>{amountInWords}</div>
              </div>
            )}

            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Attachment (Bill Proof) {form.descriptionType === 'Conveyance' && (form.vehicleType === '2 Wheeler' || form.vehicleType === '4 Wheeler') ? '' : '*'}</label>
              <label
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  padding: '20px 16px', border: '2px dashed var(--mx-border-strong)', borderRadius: 'var(--mx-radius-sm, 8px)',
                  background: 'var(--mx-surface-sunken)', cursor: uploading ? 'wait' : 'pointer',
                  transition: 'border-color 0.15s ease, background 0.15s ease',
                  opacity: uploading ? 0.6 : 1
                }}
                onMouseEnter={(e) => { if (!uploading) { e.currentTarget.style.borderColor = 'var(--mx-brand)'; e.currentTarget.style.background = 'var(--mx-info-subtle)'; } }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--mx-border-strong)'; e.currentTarget.style.background = 'var(--mx-surface-sunken)'; }}
              >
                <input type="file" multiple accept="image/*,.pdf" onChange={(e) => { handleUpload(e.target.files); e.target.value = ''; }} disabled={uploading} style={{ display: 'none' }} />
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--mx-ink-faint)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 6 }}>
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                {uploading
                  ? <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--mx-ink-muted)' }}>Uploading…</span>
                  : <>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--mx-ink)' }}>Click to upload bill proof</span>
                      <span style={{ fontSize: '11.5px', color: 'var(--mx-ink-faint)', marginTop: 2 }}>Images or PDF up to 10 MB</span>
                    </>
                }
              </label>
              {form.attachmentUrls.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
                  {form.attachmentUrls.map((url, i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                      background: 'var(--mx-surface)', border: '1px solid var(--mx-border-strong)',
                      borderRadius: 'var(--mx-radius-xs, 6px)'
                    }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--mx-success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" />
                      </svg>
                      <a href={url} target="_blank" rel="noopener noreferrer" style={{ flex: 1, fontSize: '13px', color: 'var(--mx-info)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {friendlyFileName(url)}
                      </a>
                      <button type="button" onClick={() => setForm((f) => ({ ...f, attachmentUrls: f.attachmentUrls.filter((_, j) => j !== i) }))} style={{
                        background: 'none', border: '1px solid var(--mx-danger)', color: 'var(--mx-danger)',
                        cursor: 'pointer', padding: '2px 8px', borderRadius: 'var(--mx-radius-xs, 4px)', fontSize: '11px', fontWeight: 600,
                        transition: 'background 0.15s ease'
                      }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--mx-danger-subtle)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
                      >Remove</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button type="submit" className={`${historyStyles.button} ${historyStyles.primary}`} disabled={saving || uploading}>
                {saving ? 'Saving…' : (editId ? 'Update Entry' : 'Add Entry')}
              </button>
              <button type="button" className={historyStyles.button} onClick={cancelForm}>Cancel</button>
            </div>
          </form>
        </>
      )}

      {/* Monthly sheet */}
      {loading ? (
        <p className={historyStyles.status}>Loading…</p>
      ) : records.length === 0 ? (
        <div className={historyStyles.empty}>No reimbursement entries for {MONTHS[month - 1]} {year}.</div>
      ) : (
        <>
          <p className={historyStyles.status}>{records.length} entr{records.length === 1 ? 'y' : 'ies'} found for {MONTHS[month - 1]} {year}.</p>
          <div className={historyStyles.tableWrap}>
            <table className={historyStyles.table}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Employee(s)</th>
                  <th>From</th>
                  <th>To</th>
                  <th>KM</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                  <th>Payment</th>
                  <th>Bill Proof</th>
                  {canEdit && <th></th>}
                </tr>
              </thead>
              <tbody>
                {records.map((rec, i) => (
                  <tr key={rec.id}>
                    <td style={{ color: 'var(--mx-ink-faint)', fontSize: '12px' }}>{i + 1}</td>
                    <td style={{ whiteSpace: 'nowrap', fontWeight: 500 }}>{formatDate(rec.date)}</td>
                    <td style={{ maxWidth: 180 }}>{rec.description || <span style={{ opacity: 0.35 }}>—</span>}</td>
                    <td>
                      {rec.employee_names.length > 0 ? (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {rec.employee_names.map((name, j) => (
                            <span key={j} style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 10, background: 'var(--mx-info-subtle)', color: 'var(--mx-info)', fontSize: '11.5px', fontWeight: 600, whiteSpace: 'nowrap' }}>{name}</span>
                          ))}
                        </div>
                      ) : <span style={{ opacity: 0.35 }}>—</span>}
                    </td>
                    <td>{rec.from_location || <span style={{ opacity: 0.35 }}>—</span>}</td>
                    <td>{rec.to_location || <span style={{ opacity: 0.35 }}>—</span>}</td>
                    <td className={historyStyles.num}>{rec.kilometers || <span style={{ opacity: 0.35 }}>—</span>}</td>
                    <td className={historyStyles.amount} style={{ fontWeight: 600 }}>₹{rec.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    <td>{rec.mode_of_payment ? <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 10, background: 'var(--mx-surface-sunken)', fontSize: '11.5px', fontWeight: 600, whiteSpace: 'nowrap' }}>{rec.mode_of_payment}</span> : <span style={{ opacity: 0.35 }}>—</span>}</td>
                    <td>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {rec.attachment_urls.map((url, j) => (
                          <a key={j} href={url} target="_blank" rel="noopener noreferrer" title={friendlyFileName(url)} style={{
                            display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px',
                            background: 'var(--mx-info-subtle)', color: 'var(--mx-info)',
                            borderRadius: 'var(--mx-radius-xs, 6px)', fontSize: '12px', fontWeight: 600,
                            textDecoration: 'none', whiteSpace: 'nowrap', transition: 'background 0.15s ease'
                          }}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                            View Bill{rec.attachment_urls.length > 1 ? ` ${j + 1}` : ''}
                          </a>
                        ))}
                      </div>
                    </td>
                    {canEdit && (
                      <td>
                        {(rec.created_by === currentUser.username || isPrivileged) && (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button type="button" onClick={() => startEdit(rec)} style={{
                              display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px',
                              background: 'var(--mx-surface)', border: '1px solid var(--mx-border-strong)',
                              borderRadius: 'var(--mx-radius-xs, 6px)', fontSize: '12px', fontWeight: 600,
                              color: 'var(--mx-ink)', cursor: 'pointer', transition: 'background 0.15s ease'
                            }}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                              Edit
                            </button>
                            <button type="button" onClick={() => handleDelete(rec.id)} style={{
                              display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px',
                              background: 'var(--mx-surface)', border: '1px solid var(--mx-danger)',
                              borderRadius: 'var(--mx-radius-xs, 6px)', fontSize: '12px', fontWeight: 600,
                              color: 'var(--mx-danger)', cursor: 'pointer', transition: 'background 0.15s ease'
                            }}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
                              Delete
                            </button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: 'var(--mx-surface-sunken)' }}>
                  <td colSpan={7} style={{ textAlign: 'right', fontWeight: 700, fontSize: '13.5px', borderTop: '2px solid var(--mx-border-strong)' }}>Monthly Total</td>
                  <td className={historyStyles.amount} style={{ fontWeight: 700, fontSize: '14.5px', borderTop: '2px solid var(--mx-border-strong)', color: 'var(--mx-ink)' }}>₹{total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                  <td colSpan={canEdit ? 3 : 2} style={{ fontStyle: 'italic', fontSize: '12px', color: 'var(--mx-ink-muted)', borderTop: '2px solid var(--mx-border-strong)' }}>{totalInWords}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
        </>
      )}

      {/* Pending Approvals Tab */}
      {isPrivileged && tab === 'pending' && (
        <>
          <div className={historyStyles.toolbar}>
            <button type="button" className={historyStyles.button} onClick={fetchPending}>Refresh</button>
          </div>

          {!selectedPending ? (
            <>
              {pendingLoading ? (
                <p className={historyStyles.status}>Loading pending sheets…</p>
              ) : pendingSheets.length === 0 ? (
                <div className={historyStyles.empty}>No pending approvals at the moment.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
                  {pendingSheets.map((s) => {
                    const cfg = STATUS_CONFIG[s.status] || STATUS_CONFIG.draft;
                    return (
                      <div
                        key={s.id}
                        onClick={() => openPendingSheet(s)}
                        style={{
                          padding: '14px 18px', borderRadius: 'var(--mx-radius-sm, 10px)',
                          border: '1px solid var(--mx-border-strong)', background: 'var(--mx-surface)',
                          cursor: 'pointer', transition: 'box-shadow 0.15s ease, border-color 0.15s ease',
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--mx-brand)'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(37,99,235,0.08)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--mx-border-strong)'; e.currentTarget.style.boxShadow = 'none'; }}
                      >
                        <div>
                          <div style={{ fontSize: '14.5px', fontWeight: 700, color: 'var(--mx-ink)', marginBottom: 2 }}>
                            {s.creator_name}
                            <span style={{ fontWeight: 400, fontSize: '12.5px', color: 'var(--mx-ink-faint)', marginLeft: 8 }}>
                              {s.creator_employee_id ? `(${s.creator_employee_id})` : ''}
                            </span>
                          </div>
                          <div style={{ fontSize: '12.5px', color: 'var(--mx-ink-muted)' }}>
                            {s.creator_department ? `${s.creator_department} · ` : ''}{MONTHS[s.month - 1]} {s.year} · {s.sheet_code}
                          </div>
                          <div style={{ fontSize: '12.5px', color: 'var(--mx-ink-muted)', marginTop: 2 }}>
                            {s.entry_count} entr{s.entry_count === 1 ? 'y' : 'ies'} · ₹{s.total_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                          <span style={{ padding: '4px 12px', borderRadius: 16, background: cfg.color, color: 'var(--mx-surface)', fontSize: '11.5px', fontWeight: 700 }}>
                            {cfg.label}
                          </span>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--mx-ink-faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <>
              {/* Back button + selected sheet header */}
              <button
                type="button"
                className={historyStyles.button}
                onClick={() => { setSelectedPending(null); setPendingRecords([]); }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginBottom: 12 }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
                Back to list
              </button>

              {/* Sheet info card */}
              {(() => {
                const sp = selectedPending;
                const cfg = STATUS_CONFIG[sp.status] || STATUS_CONFIG.draft;
                return (
                  <div style={{
                    padding: '16px 20px', borderRadius: 'var(--mx-radius-sm, 10px)',
                    border: `1px solid ${cfg.color}33`, background: cfg.bg, marginBottom: 16,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                      <div>
                        <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--mx-ink)' }}>
                          {sp.creator_name}
                          <span style={{ fontWeight: 400, fontSize: '13px', color: 'var(--mx-ink-faint)', marginLeft: 8 }}>
                            {sp.creator_employee_id ? `(${sp.creator_employee_id})` : ''}
                          </span>
                        </div>
                        <div style={{ fontSize: '13px', color: 'var(--mx-ink-muted)', marginTop: 2 }}>
                          {sp.creator_department ? `${sp.creator_department} · ` : ''}{sp.sheet_code} · {MONTHS[sp.month - 1]} {sp.year}
                        </div>
                        <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--mx-ink)', marginTop: 6 }}>
                          Reimbursement Total: ₹{pendingTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })} ({pendingTotalInWords})
                        </div>
                        {canSeeAdminEntries && pendingAdminTotal > 0 && (
                          <div style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--mx-blue-800)', marginTop: 3 }}>
                            Company Paid: ₹{pendingAdminTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })} (not in reimbursement)
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <button type="button" className={historyStyles.button} onClick={() => downloadVoucher(sp.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '12px', padding: '5px 12px' }}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                          Download Voucher
                        </button>
                        <span style={{ padding: '4px 14px', borderRadius: 20, background: cfg.color, color: 'var(--mx-surface)', fontSize: '12px', fontWeight: 700 }}>
                          {cfg.label}
                        </span>
                      </div>
                    </div>

                    <StepIndicator currentStep={cfg.step} status={sp.status} />

                    {/* Manager decision panel */}
                    {sp.status === 'submitted' && (
                      <div style={{ marginTop: 14, padding: '14px 16px', background: 'var(--mx-surface)', borderRadius: 'var(--mx-radius-xs, 8px)', border: '1px solid var(--mx-border-strong)' }}>
                        <div style={{ fontSize: '13.5px', fontWeight: 700, marginBottom: 10, color: 'var(--mx-ink)' }}>Your Decision</div>
                        <textarea
                          className={calcStyles.formControl}
                          rows={2}
                          placeholder="Remarks (optional for approval, required for changes)"
                          value={actionRemarks}
                          onChange={(e) => setActionRemarks(e.target.value)}
                          style={{ marginBottom: 10, width: '100%' }}
                        />
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button type="button" className={`${historyStyles.button} ${historyStyles.primary}`} disabled={actionLoading}
                            onClick={() => handlePendingAction('manager-decide', { decision: 'manager_approved', remarks: actionRemarks })}
                            style={{ background: 'var(--mx-green-600)', borderColor: 'var(--mx-green-600)' }}>
                            {actionLoading ? 'Processing…' : 'Approve & Forward to HR'}
                          </button>
                          <button type="button" className={historyStyles.button} disabled={actionLoading}
                            onClick={() => {
                              if (!actionRemarks.trim()) { toast.error('Please provide remarks for the change request.'); return; }
                              handlePendingAction('manager-decide', { decision: 'manager_change_requested', remarks: actionRemarks });
                            }}
                            style={{ color: 'var(--mx-brand)', borderColor: 'var(--mx-brand)' }}>
                            Request Changes
                          </button>
                        </div>
                      </div>
                    )}

                    {/* HR decision panel */}
                    {sp.status === 'manager_approved' && (
                      <div style={{ marginTop: 14, padding: '14px 16px', background: 'var(--mx-surface)', borderRadius: 'var(--mx-radius-xs, 8px)', border: '1px solid var(--mx-border-strong)' }}>
                        <div style={{ fontSize: '13.5px', fontWeight: 700, marginBottom: 6, color: 'var(--mx-ink)' }}>HR Review</div>
                        {sp.manager_name && (
                          <div style={{ fontSize: '12px', color: 'var(--mx-ink-faint)', marginBottom: 10 }}>
                            Manager: {sp.manager_name} approved{sp.manager_action_at ? ` on ${formatDate(sp.manager_action_at)}` : ''}
                            {sp.manager_remarks ? ` — "${sp.manager_remarks}"` : ''}
                          </div>
                        )}
                        <textarea
                          className={calcStyles.formControl}
                          rows={2}
                          placeholder="Remarks (optional for approval, required for changes)"
                          value={actionRemarks}
                          onChange={(e) => setActionRemarks(e.target.value)}
                          style={{ marginBottom: 10, width: '100%' }}
                        />
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button type="button" className={`${historyStyles.button} ${historyStyles.primary}`} disabled={actionLoading}
                            onClick={() => handlePendingAction('hr-decide', { decision: 'hr_approved', remarks: actionRemarks })}
                            style={{ background: 'var(--mx-green-600)', borderColor: 'var(--mx-green-600)' }}>
                            {actionLoading ? 'Processing…' : 'Approve & Forward to Accounts'}
                          </button>
                          <button type="button" className={historyStyles.button} disabled={actionLoading}
                            onClick={() => {
                              if (!actionRemarks.trim()) { toast.error('Please provide remarks for the change request.'); return; }
                              handlePendingAction('hr-decide', { decision: 'hr_change_requested', remarks: actionRemarks });
                            }}
                            style={{ color: 'var(--mx-brand)', borderColor: 'var(--mx-brand)' }}>
                            Request Changes
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Accounts payment panel */}
                    {sp.status === 'hr_approved' && (
                      <div style={{ marginTop: 14, padding: '14px 16px', background: 'var(--mx-surface)', borderRadius: 'var(--mx-radius-xs, 8px)', border: '1px solid var(--mx-border-strong)' }}>
                        <div style={{ fontSize: '13.5px', fontWeight: 700, marginBottom: 10, color: 'var(--mx-ink)' }}>Process Payment</div>
                        <div className={`${calcStyles.row} ${calcStyles.columns}`} style={{ marginBottom: 10 }}>
                          <div className={calcStyles.field}>
                            <label className={calcStyles.label}>Payment Reference</label>
                            <input type="text" className={calcStyles.formControl} value={paymentRef} onChange={(e) => setPaymentRef(e.target.value)} placeholder="Transaction ID / UTR / Cheque No." />
                          </div>
                          <div className={calcStyles.field}>
                            <label className={calcStyles.label}>Remarks</label>
                            <input type="text" className={calcStyles.formControl} value={actionRemarks} onChange={(e) => setActionRemarks(e.target.value)} placeholder="Optional remarks" />
                          </div>
                        </div>
                        <button type="button" className={`${historyStyles.button} ${historyStyles.primary}`} disabled={actionLoading}
                          onClick={() => handlePendingAction('accounts-complete', { paymentReference: paymentRef, remarks: actionRemarks })}
                          style={{ background: 'var(--mx-green-600)', borderColor: 'var(--mx-green-600)' }}>
                          {actionLoading ? 'Processing…' : 'Mark Payment Done'}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Entries table */}
              {pendingDetailLoading ? (
                <p className={historyStyles.status}>Loading entries…</p>
              ) : pendingRecords.length === 0 ? (
                <div className={historyStyles.empty}>No entries found.</div>
              ) : (
                <div className={historyStyles.tableWrap}>
                  <table className={historyStyles.table}>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Date</th>
                        <th>Description</th>
                        <th>Employee(s)</th>
                        <th>From</th>
                        <th>To</th>
                        <th>KM</th>
                        <th style={{ textAlign: 'right' }}>Amount</th>
                        <th>Payment</th>
                        <th>Bill Proof</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pendingRecords.map((rec, i) => (
                        <tr key={rec.id}>
                          <td style={{ color: 'var(--mx-ink-faint)', fontSize: '12px' }}>{i + 1}</td>
                          <td style={{ whiteSpace: 'nowrap', fontWeight: 500 }}>{formatDate(rec.date)}</td>
                          <td style={{ maxWidth: 180 }}>{rec.description || <span style={{ opacity: 0.35 }}>—</span>}</td>
                          <td>
                            {rec.employee_names.length > 0 ? (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                {rec.employee_names.map((name, j) => (
                                  <span key={j} style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 10, background: 'var(--mx-info-subtle)', color: 'var(--mx-info)', fontSize: '11.5px', fontWeight: 600, whiteSpace: 'nowrap' }}>{name}</span>
                                ))}
                              </div>
                            ) : <span style={{ opacity: 0.35 }}>—</span>}
                          </td>
                          <td>{rec.from_location || <span style={{ opacity: 0.35 }}>—</span>}</td>
                          <td>{rec.to_location || <span style={{ opacity: 0.35 }}>—</span>}</td>
                          <td className={historyStyles.num}>{rec.kilometers || <span style={{ opacity: 0.35 }}>—</span>}</td>
                          <td className={historyStyles.amount} style={{ fontWeight: 600 }}>
                            {editingAmountId === rec.id ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <input
                                  type="number" step="0.01" min="0.01" autoFocus
                                  value={editingAmountValue}
                                  onChange={(e) => setEditingAmountValue(e.target.value)}
                                  onKeyDown={(e) => { if (e.key === 'Enter') handleHrAmountEdit(rec.id); if (e.key === 'Escape') setEditingAmountId(null); }}
                                  style={{ width: 90, padding: '3px 6px', fontSize: '12px', border: '1px solid #d1d5db', borderRadius: 4, textAlign: 'right' }}
                                  disabled={editingAmountLoading}
                                />
                                <button onClick={() => handleHrAmountEdit(rec.id)} disabled={editingAmountLoading} style={{ padding: '2px 6px', fontSize: '11px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>{editingAmountLoading ? '...' : 'Save'}</button>
                                <button onClick={() => setEditingAmountId(null)} disabled={editingAmountLoading} style={{ padding: '2px 6px', fontSize: '11px', background: '#e5e7eb', color: '#374151', border: 'none', borderRadius: 4, cursor: 'pointer' }}>Cancel</button>
                              </div>
                            ) : (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                                <span>{'₹'}{rec.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                                {isHr && (
                                  <button onClick={() => { setEditingAmountId(rec.id); setEditingAmountValue(String(rec.amount)); }} title="Edit amount" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--mx-ink-muted, #6b7280)', display: 'inline-flex' }}>
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                  </button>
                                )}
                              </div>
                            )}
                          </td>
                          <td>{rec.mode_of_payment ? <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 10, background: 'var(--mx-surface-sunken, #f3f4f6)', fontSize: '11.5px', fontWeight: 600, whiteSpace: 'nowrap' }}>{rec.mode_of_payment}</span> : <span style={{ opacity: 0.35 }}>—</span>}</td>
                          <td>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                              {rec.attachment_urls.map((url, j) => (
                                <a key={j} href={url} target="_blank" rel="noopener noreferrer" title={friendlyFileName(url)} style={{
                                  display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px',
                                  background: 'var(--mx-info-subtle)', color: 'var(--mx-info)',
                                  borderRadius: 'var(--mx-radius-xs, 6px)', fontSize: '12px', fontWeight: 600,
                                  textDecoration: 'none', whiteSpace: 'nowrap',
                                }}>
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                                  View Bill{rec.attachment_urls.length > 1 ? ` ${j + 1}` : ''}
                                </a>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: 'var(--mx-surface-sunken)' }}>
                        <td colSpan={7} style={{ textAlign: 'right', fontWeight: 700, fontSize: '13.5px', borderTop: '2px solid var(--mx-border-strong)' }}>Monthly Total</td>
                        <td className={historyStyles.amount} style={{ fontWeight: 700, fontSize: '14.5px', borderTop: '2px solid var(--mx-border-strong)', color: 'var(--mx-ink)' }}>₹{pendingTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                        <td colSpan={2} style={{ fontStyle: 'italic', fontSize: '12px', color: 'var(--mx-ink-muted)', borderTop: '2px solid var(--mx-border-strong)' }}>{pendingTotalInWords}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}

              {/* Admin Entries (Company Paid) — visible to HR/Accounts/Admin/Superadmin only */}
              {canSeeAdminEntries && pendingAdminRecords.length > 0 && (
                <div style={{ marginTop: 20 }}>
                  <div style={{
                    padding: '10px 16px', borderRadius: '8px 8px 0 0',
                    background: 'var(--mx-blue-100)', border: '1px solid var(--mx-blue-300)', borderBottom: 'none',
                    fontSize: '13.5px', fontWeight: 700, color: 'var(--mx-blue-800)',
                  }}>
                    Company Paid Expenses (Added by Admin) — Not included in reimbursement
                  </div>
                  <div className={historyStyles.tableWrap} style={{ borderRadius: '0 0 8px 8px' }}>
                    <table className={historyStyles.table}>
                      <thead>
                        <tr style={{ background: 'var(--mx-blue-50)' }}>
                          <th>#</th>
                          <th>Date</th>
                          <th>Description</th>
                          <th>From</th>
                          <th>To</th>
                          <th style={{ textAlign: 'right' }}>Total</th>
                          <th style={{ textAlign: 'center' }}>Split</th>
                          <th style={{ textAlign: 'right' }}>Per Person</th>
                          <th>Payment</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pendingAdminRecords.map((rec, i) => (
                          <tr key={rec.id} style={{ background: i % 2 === 0 ? 'var(--mx-blue-50)' : 'var(--mx-surface)' }}>
                            <td style={{ color: 'var(--mx-ink-faint)', fontSize: '12px' }}>{i + 1}</td>
                            <td style={{ whiteSpace: 'nowrap', fontWeight: 500 }}>{formatDate(rec.date)}</td>
                            <td>{rec.description || '—'}</td>
                            <td>{rec.from_location || '—'}</td>
                            <td>{rec.to_location || '—'}</td>
                            <td style={{ textAlign: 'right', fontSize: '12px', color: 'var(--mx-ink-muted)' }}>
                              {rec.admin_total_amount ? `₹${rec.admin_total_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—'}
                            </td>
                            <td style={{ textAlign: 'center', fontSize: '12px', color: 'var(--mx-ink-muted)' }}>
                              {rec.admin_split_count ? `÷ ${rec.admin_split_count}` : '—'}
                            </td>
                            <td className={historyStyles.amount} style={{ fontWeight: 600, color: 'var(--mx-blue-800)' }}>
                              ₹{rec.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </td>
                            <td>
                              <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 10, background: 'var(--mx-blue-100)', fontSize: '11.5px', fontWeight: 600, color: 'var(--mx-blue-800)', whiteSpace: 'nowrap' }}>
                                {rec.mode_of_payment || 'Company Paid'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={{ background: 'var(--mx-blue-50)' }}>
                          <td colSpan={7} style={{ textAlign: 'right', fontWeight: 700, fontSize: '13.5px', borderTop: '2px solid var(--mx-blue-300)', color: 'var(--mx-blue-800)' }}>Company Paid Total</td>
                          <td className={historyStyles.amount} style={{ fontWeight: 700, fontSize: '14.5px', borderTop: '2px solid var(--mx-blue-300)', color: 'var(--mx-blue-800)' }}>
                            ₹{pendingAdminTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </td>
                          <td style={{ borderTop: '2px solid var(--mx-blue-300)' }} />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Approved Tab */}
      {isPrivileged && tab === 'approved' && (
        <>
          <div className={historyStyles.toolbar}>
            <button type="button" className={historyStyles.button} onClick={fetchApproved}>Refresh</button>
          </div>

          {!selectedApproved ? (
            <>
              {approvedLoading ? (
                <p className={historyStyles.status}>Loading…</p>
              ) : approvedSheets.length === 0 ? (
                <div className={historyStyles.empty}>No approved sheets yet.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
                  {approvedSheets.map((s) => {
                    const cfg = STATUS_CONFIG[s.status] || STATUS_CONFIG.draft;
                    return (
                      <div
                        key={s.id}
                        onClick={() => openApprovedSheet(s)}
                        style={{
                          padding: '14px 18px', borderRadius: 'var(--mx-radius-sm, 10px)',
                          border: '1px solid var(--mx-border-strong)', background: 'var(--mx-surface)',
                          cursor: 'pointer', transition: 'box-shadow 0.15s ease, border-color 0.15s ease',
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--mx-brand)'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(37,99,235,0.08)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--mx-border-strong)'; e.currentTarget.style.boxShadow = 'none'; }}
                      >
                        <div>
                          <div style={{ fontSize: '14.5px', fontWeight: 700, color: 'var(--mx-ink)', marginBottom: 2 }}>
                            {s.creator_name}
                            <span style={{ fontWeight: 400, fontSize: '12.5px', color: 'var(--mx-ink-faint)', marginLeft: 8 }}>
                              {s.creator_employee_id ? `(${s.creator_employee_id})` : ''}
                            </span>
                          </div>
                          <div style={{ fontSize: '12.5px', color: 'var(--mx-ink-muted)' }}>
                            {s.creator_department ? `${s.creator_department} · ` : ''}{MONTHS[s.month - 1]} {s.year} · {s.sheet_code}
                          </div>
                          <div style={{ fontSize: '12.5px', color: 'var(--mx-ink-muted)', marginTop: 2 }}>
                            {s.entry_count} entr{s.entry_count === 1 ? 'y' : 'ies'} · ₹{s.total_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                          <span style={{ padding: '4px 12px', borderRadius: 16, background: cfg.color, color: 'var(--mx-surface)', fontSize: '11.5px', fontWeight: 700 }}>
                            {cfg.label}
                          </span>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--mx-ink-faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <>
              <button
                type="button"
                className={historyStyles.button}
                onClick={() => { setSelectedApproved(null); setApprovedRecords([]); }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginBottom: 12 }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
                Back to list
              </button>

              {(() => {
                const sa = selectedApproved;
                const cfg = STATUS_CONFIG[sa.status] || STATUS_CONFIG.draft;
                return (
                  <div style={{
                    padding: '16px 20px', borderRadius: 'var(--mx-radius-sm, 10px)',
                    border: `1px solid ${cfg.color}33`, background: cfg.bg, marginBottom: 16,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                      <div>
                        <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--mx-ink)' }}>
                          {sa.creator_name}
                          <span style={{ fontWeight: 400, fontSize: '13px', color: 'var(--mx-ink-faint)', marginLeft: 8 }}>
                            {sa.creator_employee_id ? `(${sa.creator_employee_id})` : ''}
                          </span>
                        </div>
                        <div style={{ fontSize: '13px', color: 'var(--mx-ink-muted)', marginTop: 2 }}>
                          {sa.creator_department ? `${sa.creator_department} · ` : ''}{sa.sheet_code} · {MONTHS[sa.month - 1]} {sa.year}
                        </div>
                        <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--mx-ink)', marginTop: 6 }}>
                          Reimbursement Total: ₹{approvedTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })} ({approvedTotalInWords})
                        </div>
                        {canSeeAdminEntries && approvedAdminTotal > 0 && (
                          <div style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--mx-blue-800)', marginTop: 3 }}>
                            Company Paid: ₹{approvedAdminTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })} (not in reimbursement)
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <button type="button" className={historyStyles.button} onClick={() => downloadVoucher(sa.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '12px', padding: '5px 12px' }}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                          Download Voucher
                        </button>
                        <span style={{ padding: '4px 14px', borderRadius: 20, background: cfg.color, color: 'var(--mx-surface)', fontSize: '12px', fontWeight: 700 }}>
                          {cfg.label}
                        </span>
                      </div>
                    </div>

                    <StepIndicator currentStep={cfg.step} status={sa.status} />

                    {sa.manager_name && (
                      <div style={{ fontSize: '12.5px', color: 'var(--mx-ink-muted)', marginTop: 4 }}>
                        Manager: {sa.manager_name}{sa.manager_action_at ? ` on ${formatDate(sa.manager_action_at)}` : ''}
                        {sa.manager_remarks ? ` — "${sa.manager_remarks}"` : ''}
                      </div>
                    )}
                    {sa.hr_reviewer_name && (
                      <div style={{ fontSize: '12.5px', color: 'var(--mx-ink-muted)', marginTop: 2 }}>
                        HR: {sa.hr_reviewer_name}{sa.hr_reviewed_at ? ` on ${formatDate(sa.hr_reviewed_at)}` : ''}
                        {sa.hr_remarks ? ` — "${sa.hr_remarks}"` : ''}
                      </div>
                    )}
                    {sa.accounts_handler_name && (
                      <div style={{ fontSize: '12.5px', color: 'var(--mx-ink-muted)', marginTop: 2 }}>
                        Accounts: {sa.accounts_handler_name}{sa.accounts_completed_at ? ` on ${formatDate(sa.accounts_completed_at)}` : ''}
                        {sa.payment_reference ? ` — Ref: ${sa.payment_reference}` : ''}
                      </div>
                    )}
                  </div>
                );
              })()}

              {approvedDetailLoading ? (
                <p className={historyStyles.status}>Loading entries…</p>
              ) : approvedRecords.length === 0 ? (
                <div className={historyStyles.empty}>No entries found.</div>
              ) : (
                <div className={historyStyles.tableWrap}>
                  <table className={historyStyles.table}>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Date</th>
                        <th>Description</th>
                        <th>Employee(s)</th>
                        <th>From</th>
                        <th>To</th>
                        <th>KM</th>
                        <th style={{ textAlign: 'right' }}>Amount</th>
                        <th>Payment</th>
                        <th>Bill Proof</th>
                      </tr>
                    </thead>
                    <tbody>
                      {approvedRecords.map((rec, i) => (
                        <tr key={rec.id}>
                          <td style={{ color: 'var(--mx-ink-faint)', fontSize: '12px' }}>{i + 1}</td>
                          <td style={{ whiteSpace: 'nowrap', fontWeight: 500 }}>{formatDate(rec.date)}</td>
                          <td style={{ maxWidth: 180 }}>{rec.description || <span style={{ opacity: 0.35 }}>—</span>}</td>
                          <td>
                            {rec.employee_names.length > 0 ? (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                {rec.employee_names.map((name, j) => (
                                  <span key={j} style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 10, background: 'var(--mx-info-subtle)', color: 'var(--mx-info)', fontSize: '11.5px', fontWeight: 600, whiteSpace: 'nowrap' }}>{name}</span>
                                ))}
                              </div>
                            ) : <span style={{ opacity: 0.35 }}>—</span>}
                          </td>
                          <td>{rec.from_location || <span style={{ opacity: 0.35 }}>—</span>}</td>
                          <td>{rec.to_location || <span style={{ opacity: 0.35 }}>—</span>}</td>
                          <td className={historyStyles.num}>{rec.kilometers || <span style={{ opacity: 0.35 }}>—</span>}</td>
                          <td className={historyStyles.amount} style={{ fontWeight: 600 }}>₹{rec.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                          <td>{rec.mode_of_payment ? <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 10, background: 'var(--mx-surface-sunken)', fontSize: '11.5px', fontWeight: 600, whiteSpace: 'nowrap' }}>{rec.mode_of_payment}</span> : <span style={{ opacity: 0.35 }}>—</span>}</td>
                          <td>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                              {rec.attachment_urls.map((url, j) => (
                                <a key={j} href={url} target="_blank" rel="noopener noreferrer" title={friendlyFileName(url)} style={{
                                  display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px',
                                  background: 'var(--mx-info-subtle)', color: 'var(--mx-info)',
                                  borderRadius: 'var(--mx-radius-xs, 6px)', fontSize: '12px', fontWeight: 600,
                                  textDecoration: 'none', whiteSpace: 'nowrap',
                                }}>
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                                  View Bill{rec.attachment_urls.length > 1 ? ` ${j + 1}` : ''}
                                </a>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: 'var(--mx-surface-sunken)' }}>
                        <td colSpan={7} style={{ textAlign: 'right', fontWeight: 700, fontSize: '13.5px', borderTop: '2px solid var(--mx-border-strong)' }}>Monthly Total</td>
                        <td className={historyStyles.amount} style={{ fontWeight: 700, fontSize: '14.5px', borderTop: '2px solid var(--mx-border-strong)', color: 'var(--mx-ink)' }}>₹{approvedTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                        <td colSpan={2} style={{ fontStyle: 'italic', fontSize: '12px', color: 'var(--mx-ink-muted)', borderTop: '2px solid var(--mx-border-strong)' }}>{approvedTotalInWords}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}

              {/* Admin Entries (Company Paid) — visible to HR/Accounts/Admin/Superadmin only */}
              {canSeeAdminEntries && approvedAdminRecords.length > 0 && (
                <div style={{ marginTop: 20 }}>
                  <div style={{
                    padding: '10px 16px', borderRadius: '8px 8px 0 0',
                    background: 'var(--mx-blue-100)', border: '1px solid var(--mx-blue-300)', borderBottom: 'none',
                    fontSize: '13.5px', fontWeight: 700, color: 'var(--mx-blue-800)',
                  }}>
                    Company Paid Expenses (Added by Admin) — Not included in reimbursement
                  </div>
                  <div className={historyStyles.tableWrap} style={{ borderRadius: '0 0 8px 8px' }}>
                    <table className={historyStyles.table}>
                      <thead>
                        <tr style={{ background: 'var(--mx-blue-50)' }}>
                          <th>#</th>
                          <th>Date</th>
                          <th>Description</th>
                          <th>From</th>
                          <th>To</th>
                          <th style={{ textAlign: 'right' }}>Total</th>
                          <th style={{ textAlign: 'center' }}>Split</th>
                          <th style={{ textAlign: 'right' }}>Per Person</th>
                          <th>Payment</th>
                        </tr>
                      </thead>
                      <tbody>
                        {approvedAdminRecords.map((rec, i) => (
                          <tr key={rec.id} style={{ background: i % 2 === 0 ? 'var(--mx-blue-50)' : 'var(--mx-surface)' }}>
                            <td style={{ color: 'var(--mx-ink-faint)', fontSize: '12px' }}>{i + 1}</td>
                            <td style={{ whiteSpace: 'nowrap', fontWeight: 500 }}>{formatDate(rec.date)}</td>
                            <td>{rec.description || '—'}</td>
                            <td>{rec.from_location || '—'}</td>
                            <td>{rec.to_location || '—'}</td>
                            <td style={{ textAlign: 'right', fontSize: '12px', color: 'var(--mx-ink-muted)' }}>
                              {rec.admin_total_amount ? `₹${rec.admin_total_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—'}
                            </td>
                            <td style={{ textAlign: 'center', fontSize: '12px', color: 'var(--mx-ink-muted)' }}>
                              {rec.admin_split_count ? `÷ ${rec.admin_split_count}` : '—'}
                            </td>
                            <td className={historyStyles.amount} style={{ fontWeight: 600, color: 'var(--mx-blue-800)' }}>
                              ₹{rec.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </td>
                            <td>
                              <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 10, background: 'var(--mx-blue-100)', fontSize: '11.5px', fontWeight: 600, color: 'var(--mx-blue-800)', whiteSpace: 'nowrap' }}>
                                {rec.mode_of_payment || 'Company Paid'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={{ background: 'var(--mx-blue-50)' }}>
                          <td colSpan={7} style={{ textAlign: 'right', fontWeight: 700, fontSize: '13.5px', borderTop: '2px solid var(--mx-blue-300)', color: 'var(--mx-blue-800)' }}>Company Paid Total</td>
                          <td className={historyStyles.amount} style={{ fontWeight: 700, fontSize: '14.5px', borderTop: '2px solid var(--mx-blue-300)', color: 'var(--mx-blue-800)' }}>
                            ₹{approvedAdminTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </td>
                          <td style={{ borderTop: '2px solid var(--mx-blue-300)' }} />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </AppShell>
  );
}
