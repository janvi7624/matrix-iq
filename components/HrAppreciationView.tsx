'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import AppShell from './AppShell';
import { useToast } from './ui/ToastProvider';
import styles from './hrAppreciation.module.css';

interface Row {
  id: string;
  employee_name: string;
  employee_department: string;
  nominated_by: string | null;
  nominated_by_name: string;
  category: string;
  achievement_date: string;
  description: string;
  attachment_url: string;
  reward_type: 'none' | 'certificate' | 'gift_voucher' | 'cash';
  reward_amount: number | null;
  status: 'pending' | 'approved' | 'rejected';
  hr_reviewer_name: string;
  hr_remarks: string;
  decided_at: string | null;
  created_at: string;
}

interface Employee {
  id: string;
  name: string;
  department: string;
  designation: string;
}

const REWARD_LABEL: Record<Row['reward_type'], string> = {
  none: 'No reward',
  certificate: 'Certificate',
  gift_voucher: 'Gift voucher',
  cash: 'Cash'
};

const STATUS_LABEL: Record<Row['status'], string> = { pending: 'Pending HR', approved: 'Approved', rejected: 'Rejected' };

const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const fmtReward = (r: Row) =>
  r.reward_type === 'none' ? 'None' : `${REWARD_LABEL[r.reward_type]}${r.reward_amount ? ` · ₹${r.reward_amount.toLocaleString('en-IN')}` : ''}`;

const EMPTY_FORM = { employeeId: '', category: '', achievementDate: today(), description: '', rewardType: 'none', rewardAmount: '', attachmentUrl: '' };

export default function HrAppreciationView() {
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [isDecider, setIsDecider] = useState(false);
  const [canSubmit, setCanSubmit] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [tab, setTab] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [remarks, setRemarks] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await fetch('/api/hr/appreciations');
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Could not load appreciations');
      setRows(data.rows || []);
      setCategories(data.categories || []);
      setIsDecider(!!data.isDecider);
      setCanSubmit(!!data.canSubmit);
      if (data.canSubmit) {
        const e = await fetch('/api/hr/appreciations/employees').then((r) => (r.ok ? r.json() : []));
        setEmployees(Array.isArray(e) ? e : []);
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not load appreciations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(
    () => ({
      pending: rows.filter((r) => r.status === 'pending').length,
      approved: rows.filter((r) => r.status === 'approved').length,
      rejected: rows.filter((r) => r.status === 'rejected').length,
      all: rows.length
    }),
    [rows]
  );
  const visible = tab === 'all' ? rows : rows.filter((r) => r.status === tab);

  async function uploadAttachment(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('folder', 'appreciations');
      fd.append('files', file);
      const res = await fetch('/api/uploads', { method: 'POST', body: fd });
      if (!res.ok) throw new Error();
      const body: { urls: string[] } = await res.json();
      setForm((f) => ({ ...f, attachmentUrl: body.urls[0] || '' }));
    } catch {
      toast.error('Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/hr/appreciations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form)
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || 'Could not submit');
        return;
      }
      toast.success('Appreciation sent to HR for approval');
      setForm({ ...EMPTY_FORM, achievementDate: today() });
      setShowForm(false);
      setTab('pending');
      load();
    } finally {
      setSaving(false);
    }
  }

  async function decide(row: Row, decision: 'approved' | 'rejected') {
    const remark = (remarks[row.id] || '').trim();
    if (decision === 'rejected' && !remark) {
      toast.error('Add a remark explaining the rejection');
      return;
    }
    setDeciding(row.id);
    try {
      const res = await fetch(`/api/hr/appreciations/${row.id}/decision`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision, remarks: remark })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || 'Could not save the decision');
        return;
      }
      toast.success(decision === 'approved' ? `Approved — ${row.employee_name} has been notified` : 'Rejected — the manager has been notified');
      load();
    } finally {
      setDeciding(null);
    }
  }

  const needsAmount = form.rewardType === 'gift_voucher' || form.rewardType === 'cash';

  return (
    <AppShell
      title="Employee Appreciation"
      subtitle={isDecider ? 'Review appreciations submitted by managers. Approved ones are announced on the dashboard.' : 'Recognise great work in your team. HR reviews every appreciation before it is announced.'}
    >
      <div className={styles.toolbar}>
        <div className={styles.tabs} role="tablist">
          {(['pending', 'approved', 'rejected', 'all'] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={`${styles.tab} ${tab === t ? styles.tabActive : ''}`} onClick={() => setTab(t)}>
              {t === 'all' ? 'All' : STATUS_LABEL[t]} <span className={styles.count}>{counts[t]}</span>
            </button>
          ))}
        </div>
        {canSubmit && !showForm && (
          <button type="button" className={styles.primary} onClick={() => setShowForm(true)}>
            + Appreciate an employee
          </button>
        )}
      </div>

      {showForm && (
        <form className={styles.card} onSubmit={submit}>
          <h3 className={styles.cardTitle}>New appreciation</h3>
          <div className={styles.grid}>
            <label className={styles.field}>
              <span>Employee *</span>
              <select value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} required>
                <option value="">Select employee…</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name}
                    {emp.department ? ` — ${emp.department}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span>Category *</span>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} required>
                <option value="">Select category…</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span>Achievement date *</span>
              <input type="date" max={today()} value={form.achievementDate} onChange={(e) => setForm({ ...form, achievementDate: e.target.value })} required />
            </label>
            <label className={styles.field}>
              <span>Recommended reward</span>
              <select value={form.rewardType} onChange={(e) => setForm({ ...form, rewardType: e.target.value, rewardAmount: '' })}>
                {Object.entries(REWARD_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            {needsAmount && (
              <label className={styles.field}>
                <span>Amount (₹) *</span>
                <input type="number" min="1" step="1" value={form.rewardAmount} onChange={(e) => setForm({ ...form, rewardAmount: e.target.value })} required />
              </label>
            )}
            <label className={styles.field}>
              <span>Attachment (optional)</span>
              <input type="file" onChange={(e) => e.target.files?.[0] && uploadAttachment(e.target.files[0])} disabled={uploading} />
              {uploading && <small>Uploading…</small>}
              {form.attachmentUrl && !uploading && <small>Attached ✓</small>}
            </label>
          </div>
          <label className={`${styles.field} ${styles.full}`}>
            <span>What did they do? *</span>
            <textarea rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Describe the achievement and its impact…" required minLength={10} />
          </label>
          <div className={styles.formActions}>
            <button type="button" className={styles.secondary} onClick={() => setShowForm(false)} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className={styles.primary} disabled={saving || uploading}>
              {saving ? 'Submitting…' : 'Submit to HR'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className={styles.empty}>Loading…</div>
      ) : loadError ? (
        <div className={styles.empty}>
          {loadError}{' '}
          <button type="button" className={styles.linkBtn} onClick={load}>
            Retry
          </button>
        </div>
      ) : visible.length === 0 ? (
        <div className={styles.empty}>{tab === 'pending' ? 'Nothing waiting for review.' : 'No appreciations here yet.'}</div>
      ) : (
        <div className={styles.list}>
          {visible.map((r) => (
            <article key={r.id} className={styles.card}>
              <div className={styles.rowHead}>
                <div>
                  <div className={styles.name}>{r.employee_name}</div>
                  <div className={styles.meta}>
                    {r.employee_department || '—'} · {r.category} · {fmtDate(r.achievement_date)}
                  </div>
                </div>
                <span className={`${styles.badge} ${styles[`badge_${r.status}`]}`}>{STATUS_LABEL[r.status]}</span>
              </div>
              <p className={styles.desc}>{r.description}</p>
              <div className={styles.meta}>
                Nominated by {r.nominated_by_name} on {fmtDate(r.created_at)} · Reward: {fmtReward(r)}
                {r.attachment_url && (
                  <>
                    {' · '}
                    <a href={r.attachment_url} target="_blank" rel="noreferrer">
                      Attachment
                    </a>
                  </>
                )}
              </div>
              {r.status !== 'pending' && (
                <div className={styles.meta}>
                  {STATUS_LABEL[r.status]} by {r.hr_reviewer_name || 'HR'} on {fmtDate(r.decided_at)}
                  {r.hr_remarks ? ` — “${r.hr_remarks}”` : ''}
                </div>
              )}
              {isDecider && r.status === 'pending' && (
                <div className={styles.decide}>
                  <input
                    className={styles.remark}
                    placeholder="Remarks (required to reject)"
                    value={remarks[r.id] || ''}
                    onChange={(e) => setRemarks({ ...remarks, [r.id]: e.target.value })}
                  />
                  <button type="button" className={styles.reject} disabled={deciding === r.id} onClick={() => decide(r, 'rejected')}>
                    Reject
                  </button>
                  <button type="button" className={styles.approve} disabled={deciding === r.id} onClick={() => decide(r, 'approved')}>
                    Approve
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </AppShell>
  );
}
