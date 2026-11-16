'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import AppShell from './AppShell';
import { useToast } from './ui/ToastProvider';
import styles from './hrAppreciation.module.css';

interface Savings {
  costSavingsPerMonth: string;
  timeSavingsValue: string;
  timeSavingsUnit: 'days' | 'hours' | 'mins' | '';
  energySavings: string;
  teamCostSavings: string;
  miscellaneous: string;
}

interface Row {
  id: string;
  employee_name: string;
  employee_department: string;
  nominated_by: string | null;
  nominated_by_name: string;
  task_given_date: string;
  task_deadline_date: string;
  task_completion_date: string;
  savings: Savings;
  description: string;
  attachment_url: string;
  reward_type: 'none' | 'certificate' | 'gift_voucher' | 'cash';
  reward_amount: number | null;
  status: 'pending' | 'approved' | 'rejected';
  hr_reviewer_name: string;
  hr_remarks: string;
  decided_at: string | null;
  created_at: string;
  // Server-computed: this is the viewer's own submission AND it's still
  // pending — see app/api/hr/appreciations/route.ts's GET. Once HR decides
  // it, this flips false and the edit/delete controls disappear.
  can_edit: boolean;
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

const EMPTY_SAVINGS: Savings = { costSavingsPerMonth: '', timeSavingsValue: '', timeSavingsUnit: '', energySavings: '', teamCostSavings: '', miscellaneous: '' };
const EMPTY_FORM = {
  employeeId: '',
  taskGivenDate: today(),
  taskDeadlineDate: '',
  taskCompletionDate: today(),
  savings: EMPTY_SAVINGS,
  description: '',
  attachmentUrl: ''
};

// A one-line summary of whichever Savings fields the manager actually
// filled in — the form never requires any of them, so a row with none at
// all should take up no space in the list.
function savingsSummary(s: Savings | undefined | null): string {
  if (!s) return '';
  const parts: string[] = [];
  if (s.costSavingsPerMonth) parts.push(`Cost: ₹${s.costSavingsPerMonth}/mo`);
  if (s.timeSavingsValue) parts.push(`Time: ${s.timeSavingsValue}${s.timeSavingsUnit ? ` ${s.timeSavingsUnit}` : ''}`);
  if (s.energySavings) parts.push(`Energy: ${s.energySavings}`);
  if (s.teamCostSavings) parts.push(`Team cost: ₹${s.teamCostSavings}`);
  if (s.miscellaneous) parts.push(s.miscellaneous);
  return parts.join(' · ');
}

export default function HrAppreciationView() {
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [isDecider, setIsDecider] = useState(false);
  const [canSubmit, setCanSubmit] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [tab, setTab] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [remarks, setRemarks] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await fetch('/api/hr/appreciations');
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Could not load appreciations');
      setRows(data.rows || []);
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
      const url = editingId ? `/api/hr/appreciations/${editingId}` : '/api/hr/appreciations';
      const method = editingId ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form)
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || (editingId ? 'Could not save changes' : 'Could not submit'));
        return;
      }
      toast.success(editingId ? 'Changes saved' : 'Appreciation sent to HR for approval');
      setForm({ ...EMPTY_FORM, taskGivenDate: today(), taskCompletionDate: today() });
      setShowForm(false);
      setEditingId(null);
      setTab('pending');
      load();
    } finally {
      setSaving(false);
    }
  }

  function cancelForm() {
    setShowForm(false);
    setEditingId(null);
  }

  function startEdit(row: Row) {
    setEditingId(row.id);
    setForm({
      employeeId: '',
      taskGivenDate: row.task_given_date,
      taskDeadlineDate: row.task_deadline_date,
      taskCompletionDate: row.task_completion_date,
      savings: row.savings || EMPTY_SAVINGS,
      description: row.description,
      attachmentUrl: row.attachment_url
    });
    setShowForm(true);
  }

  async function handleDelete(row: Row) {
    if (!confirm(`Delete this appreciation for ${row.employee_name}? This cannot be undone.`)) return;
    setDeletingId(row.id);
    try {
      const res = await fetch(`/api/hr/appreciations/${row.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || 'Could not delete');
        return;
      }
      toast.success('Deleted');
      load();
    } finally {
      setDeletingId(null);
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

  function setSavings(patch: Partial<Savings>) {
    setForm((f) => ({ ...f, savings: { ...f.savings, ...patch } }));
  }

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
          <button
            type="button"
            className={styles.primary}
            onClick={() => {
              setEditingId(null);
              setForm({ ...EMPTY_FORM, taskGivenDate: today(), taskCompletionDate: today() });
              setShowForm(true);
            }}
          >
            + Appreciate an employee
          </button>
        )}
      </div>

      {showForm && (
        <form className={styles.card} onSubmit={submit}>
          <h3 className={styles.cardTitle}>{editingId ? 'Edit appreciation' : 'New appreciation'}</h3>
          <div className={styles.grid}>
            {!editingId && (
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
            )}
            <label className={styles.field}>
              <span>Task given date *</span>
              <input
                type="date"
                max={today()}
                value={form.taskGivenDate}
                onChange={(e) => setForm({ ...form, taskGivenDate: e.target.value })}
                required
              />
            </label>
            <label className={styles.field}>
              <span>Task deadline date *</span>
              <input
                type="date"
                min={form.taskGivenDate || undefined}
                value={form.taskDeadlineDate}
                onChange={(e) => setForm({ ...form, taskDeadlineDate: e.target.value })}
                required
              />
            </label>
            <label className={styles.field}>
              <span>Task completion date *</span>
              <input
                type="date"
                min={form.taskGivenDate || undefined}
                max={today()}
                value={form.taskCompletionDate}
                onChange={(e) => setForm({ ...form, taskCompletionDate: e.target.value })}
                required
              />
            </label>
            <label className={styles.field}>
              <span>Attachment (optional)</span>
              <input type="file" onChange={(e) => e.target.files?.[0] && uploadAttachment(e.target.files[0])} disabled={uploading} />
              {uploading && <small>Uploading…</small>}
              {form.attachmentUrl && !uploading && <small>Attached ✓</small>}
            </label>
          </div>

          <div className={styles.savingsPanel}>
            <div className={styles.savingsTitle}>Savings (optional)</div>
            <div className={styles.grid}>
              <label className={styles.field}>
                <span>Cost Savings</span>
                <div className={styles.inlineUnit}>
                  <span className={styles.inlineUnitPrefix}>₹</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={form.savings.costSavingsPerMonth}
                    onChange={(e) => setSavings({ costSavingsPerMonth: e.target.value })}
                    placeholder="e.g. 5000"
                  />
                  <span className={styles.inlineUnitSuffix}>per month</span>
                </div>
              </label>
              <label className={styles.field}>
                <span>Time Savings</span>
                <div className={styles.inlineUnit}>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={form.savings.timeSavingsValue}
                    onChange={(e) =>
                      setSavings({
                        timeSavingsValue: e.target.value,
                        timeSavingsUnit: e.target.value ? form.savings.timeSavingsUnit || 'hours' : ''
                      })
                    }
                    placeholder="e.g. 3"
                  />
                  <div className={styles.unitToggle} role="radiogroup" aria-label="Time unit">
                    {(['mins', 'hours', 'days'] as const).map((u) => (
                      <button
                        key={u}
                        type="button"
                        role="radio"
                        aria-checked={(form.savings.timeSavingsUnit || 'hours') === u}
                        className={`${styles.unitBtn} ${(form.savings.timeSavingsUnit || 'hours') === u ? styles.unitBtnActive : ''}`}
                        onClick={() => setSavings({ timeSavingsUnit: u })}
                      >
                        {u === 'mins' ? 'Minutes' : u === 'hours' ? 'Hours' : 'Days'}
                      </button>
                    ))}
                  </div>
                </div>
              </label>
              <label className={styles.field}>
                <span>Energy Savings</span>
                <input type="text" value={form.savings.energySavings} onChange={(e) => setSavings({ energySavings: e.target.value })} placeholder="e.g. 12 units/day" />
              </label>
              <label className={styles.field}>
                <span>Team Cost Savings</span>
                <div className={styles.inlineUnit}>
                  <span className={styles.inlineUnitPrefix}>₹</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={form.savings.teamCostSavings}
                    onChange={(e) => setSavings({ teamCostSavings: e.target.value })}
                    placeholder="e.g. 15000"
                  />
                </div>
              </label>
              <label className={`${styles.field} ${styles.full}`}>
                <span>Miscellaneous</span>
                <input type="text" value={form.savings.miscellaneous} onChange={(e) => setSavings({ miscellaneous: e.target.value })} placeholder="Any other saving worth noting…" />
              </label>
            </div>
          </div>

          <label className={`${styles.field} ${styles.full}`}>
            <span>What did they do? *</span>
            <textarea rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Describe the achievement and its impact…" required minLength={10} />
          </label>
          <div className={styles.formActions}>
            <button type="button" className={styles.secondary} onClick={cancelForm} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className={styles.primary} disabled={saving || uploading}>
              {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Submit to HR'}
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
                    {r.employee_department || '—'} · Task: {fmtDate(r.task_given_date)} → {fmtDate(r.task_deadline_date)} · Completed {fmtDate(r.task_completion_date)}
                  </div>
                </div>
                <span className={`${styles.badge} ${styles[`badge_${r.status}`]}`}>{STATUS_LABEL[r.status]}</span>
              </div>
              <p className={styles.desc}>{r.description}</p>
              {savingsSummary(r.savings) && <div className={styles.meta}>Savings: {savingsSummary(r.savings)}</div>}
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
              {r.can_edit && (
                <div className={styles.decide}>
                  <button type="button" className={styles.secondary} onClick={() => startEdit(r)} disabled={deletingId === r.id}>
                    Edit
                  </button>
                  <button type="button" className={styles.reject} disabled={deletingId === r.id} onClick={() => handleDelete(r)}>
                    {deletingId === r.id ? 'Deleting…' : 'Delete'}
                  </button>
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
