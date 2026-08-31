'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import AppShell from './AppShell';
import { useToast } from './ui/ToastProvider';
import { OfficeOperationExpenseRecord } from '@/lib/types';
import { exportOfficeOperationExpensesXlsx } from '@/lib/officeOperationExpenseXlsx';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';

interface OptionsPayload {
  usecases: string[];
  usecaseSubOptions: Record<string, string[]>;
  usecaseFreeText: string;
  items: string[];
  itemSubOptions: Record<string, string[]>;
}

const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '12.5px',
  fontWeight: 600,
  color: 'var(--mx-ink-muted)',
  marginBottom: 4
};

function formatDate(value: string): string {
  if (!value) return '—';
  try {
    return new Date(`${value}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return value;
  }
}

function formatCurrency(n: number): string {
  return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Zero-padded so the register reads as a column of serials rather than ragged
// integers. The stored value stays a plain number (see the migration).
function formatSrNo(n: number): string {
  return String(n).padStart(4, '0');
}

const emptyForm = {
  date: '',
  usecase: '',
  usecaseDetail: '',
  expenseHead: '',
  itemName: '',
  itemSubName: '',
  itemQty: '',
  amount: ''
};

interface OfficeOperationExpensesViewProps {
  currentUser: { name: string; department: string };
}

export default function OfficeOperationExpensesView({ currentUser }: OfficeOperationExpensesViewProps) {
  const toast = useToast();
  const now = useMemo(() => new Date(), []);

  const [options, setOptions] = useState<OptionsPayload | null>(null);
  const [records, setRecords] = useState<OfficeOperationExpenseRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [totalInWords, setTotalInWords] = useState('');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  const setField = useCallback(<K extends keyof typeof emptyForm>(key: K, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  // Which second-level fields the current selections call for. Driven entirely
  // by the server's option payload, so adding a sub-item list in
  // lib/officeOperationExpenseOptions.ts lights the dropdown up here with no
  // change to this component.
  const usecaseSubs = options && form.usecase ? options.usecaseSubOptions[form.usecase] : undefined;
  const usecaseIsFreeText = !!options && form.usecase === options.usecaseFreeText;
  const itemSubs = options && form.itemName ? options.itemSubOptions[form.itemName] : undefined;

  // Deliberately does NOT flip `loading` on at the top: this runs from the
  // month/year effect below, and a synchronous setState in an effect body
  // triggers the cascading-render pattern react-hooks/set-state-in-effect
  // rejects. `loading` starts true for the first load and is turned back on by
  // the filter handlers (a user event, where setState is fine) instead.
  const fetchRecords = useCallback(async (y: number, m: number) => {
    try {
      const res = await fetch(`/api/office-operation-expenses?year=${y}&month=${m}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || `Failed to load expenses (${res.status})`);
        return;
      }
      setRecords(data.records || []);
      setTotal(data.total || 0);
      setTotalInWords(data.totalInWords || '');
    } catch {
      toast.error('Network error while loading expenses');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetch('/api/office-operation-expenses/options')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data) setOptions(data); })
      .catch(() => { /* form falls back to disabled selects until this succeeds */ });
  }, []);

  useEffect(() => {
    // fetchRecords has no synchronous setState — every setState in it runs
    // after an `await` or in `finally` — but the rule can't see through the
    // async boundary and flags any reachable setState. Suppressed rather than
    // restructured because reloading on a filter change IS effect work.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchRecords(year, month);
  }, [year, month, fetchRecords]);

  function resetForm() {
    setForm(emptyForm);
    setEditId(null);
  }

  function startEdit(record: OfficeOperationExpenseRecord) {
    setEditId(record.id);
    setForm({
      date: record.date,
      usecase: record.usecase,
      usecaseDetail: record.usecase_detail,
      expenseHead: record.expense_head,
      itemName: record.item_name,
      itemSubName: record.item_sub_name,
      // null must reopen as an empty field, not the string "null".
      itemQty: record.item_qty === null ? '' : String(record.item_qty),
      amount: String(record.amount)
    });
    setShowForm(true);
  }

  async function handleDelete(record: OfficeOperationExpenseRecord) {
    if (!confirm(`Delete expense Sr No. ${formatSrNo(record.sr_no)}? This cannot be undone.`)) return;
    setDeleting(record.id);
    try {
      const res = await fetch(`/api/office-operation-expenses/${record.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || 'Failed to delete');
        return;
      }
      toast.success(data?.message || 'Expense deleted');
      await fetchRecords(year, month);
    } catch {
      toast.error('Network error');
    } finally {
      setDeleting(null);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!form.date) { toast.error('Select a date'); return; }
    if (!form.usecase) { toast.error('Select a usecase'); return; }
    if (usecaseSubs && !form.usecaseDetail) { toast.error(`Select which ${form.usecase.toLowerCase()} this is`); return; }
    if (usecaseIsFreeText && !form.usecaseDetail.trim()) { toast.error('Describe the usecase'); return; }
    if (!form.expenseHead.trim()) { toast.error('Enter the expense head'); return; }
    if (!form.itemName) { toast.error('Select an item'); return; }
    if (itemSubs?.length && !form.itemSubName) { toast.error(`Select a sub-item for ${form.itemName}`); return; }
    // Qty is optional — only complain when something was typed and it's not a
    // usable number.
    if (form.itemQty.trim() && !(Number(form.itemQty) > 0)) { toast.error('Item Qty must be greater than zero'); return; }
    if (!(Number(form.amount) > 0)) { toast.error('Amount must be greater than zero'); return; }

    setSaving(true);
    try {
      const payload = {
        date: form.date,
        usecase: form.usecase,
        usecaseDetail: usecaseSubs || usecaseIsFreeText ? form.usecaseDetail : '',
        expenseHead: form.expenseHead,
        itemName: form.itemName,
        itemSubName: itemSubs?.length ? form.itemSubName : '',
        // Empty string, not 0 — the server reads '' as "not specified" and
        // stores NULL, whereas 0 would fail its positive-number check.
        itemQty: form.itemQty.trim(),
        amount: Number(form.amount)
      };

      const res = await fetch(
        editId ? `/api/office-operation-expenses/${editId}` : '/api/office-operation-expenses',
        {
          method: editId ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || `Failed to save (${res.status})`);
        return;
      }

      toast.success(editId ? 'Expense updated' : `Expense saved as Sr No. ${formatSrNo(data.sr_no)}`);
      resetForm();
      setShowForm(false);

      // Jump the filter to the saved entry's month so a row dated outside the
      // month currently on screen doesn't silently vanish after saving.
      const [savedYear, savedMonth] = form.date.split('-').map(Number);
      if (savedYear !== year || savedMonth !== month) {
        setLoading(true);
        setYear(savedYear);
        setMonth(savedMonth);
      } else {
        await fetchRecords(year, month);
      }
    } catch {
      toast.error('Network error');
    } finally {
      setSaving(false);
    }
  }

  async function handleExport() {
    if (!records.length) { toast.error('Nothing to export for this month'); return; }
    try {
      await exportOfficeOperationExpensesXlsx({
        records, total, totalInWords, year, month,
        preparedBy: currentUser.name,
        department: currentUser.department
      });
    } catch (err) {
      console.error('Export error:', err);
      toast.error('Failed to build the Excel file');
    }
  }

  const yearChoices = useMemo(() => {
    const current = now.getFullYear();
    return [current + 1, current, current - 1, current - 2];
  }, [now]);

  return (
    <AppShell title="Office Operation Expenses" subtitle="HR/Admin office operating expense register">
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
          <h2 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--mx-ink)' }}>Office Operation Expenses</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select className={calcStyles.formControl} value={month} onChange={(e) => { setLoading(true); setMonth(Number(e.target.value)); }} aria-label="Month">
              {MONTH_NAMES.slice(1).map((name, i) => <option key={name} value={i + 1}>{name}</option>)}
            </select>
            <select className={calcStyles.formControl} value={year} onChange={(e) => { setLoading(true); setYear(Number(e.target.value)); }} aria-label="Year">
              {yearChoices.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <button type="button" className={historyStyles.button} onClick={handleExport} disabled={loading || !records.length}>
              Export .xlsx
            </button>
            <button
              type="button"
              className={`${historyStyles.button} ${historyStyles.primary}`}
              onClick={() => { resetForm(); setShowForm((prev) => !prev); }}
            >
              {showForm ? 'Cancel' : '+ Add Expense'}
            </button>
          </div>
        </div>

        {showForm && (
          <form
            onSubmit={handleSubmit}
            style={{
              background: 'var(--mx-surface, #fff)',
              borderRadius: 'var(--mx-radius-sm, 10px)',
              border: '1px solid var(--mx-border, #e5e7eb)',
              padding: 20,
              marginBottom: 24,
              boxShadow: 'var(--mx-shadow-xs)'
            }}
          >
            <div style={{ marginBottom: 12, fontSize: '13px', color: 'var(--mx-ink-muted)' }}>
              {editId
                ? <>Editing Sr No. is fixed — the serial never changes once assigned.</>
                : <>Sr No. is assigned automatically when you save.</>}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16, marginBottom: 16 }}>
              <div>
                <label style={labelStyle}>Date *</label>
                <input type="date" className={calcStyles.formControl} value={form.date} onChange={(e) => setField('date', e.target.value)} style={{ width: '100%' }} />
              </div>

              <div>
                <label style={labelStyle}>Usecase *</label>
                <select
                  className={calcStyles.formControl}
                  value={form.usecase}
                  onChange={(e) => { setField('usecase', e.target.value); setField('usecaseDetail', ''); }}
                  disabled={!options}
                  style={{ width: '100%' }}
                >
                  <option value="">Select usecase…</option>
                  {options?.usecases.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>

              {usecaseSubs && (
                <div>
                  <label style={labelStyle}>{form.usecase} — which one? *</label>
                  <select className={calcStyles.formControl} value={form.usecaseDetail} onChange={(e) => setField('usecaseDetail', e.target.value)} style={{ width: '100%' }}>
                    <option value="">Select…</option>
                    {usecaseSubs.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              )}

              {usecaseIsFreeText && (
                <div>
                  <label style={labelStyle}>Specify usecase *</label>
                  <input type="text" className={calcStyles.formControl} placeholder="e.g. Annual audit" value={form.usecaseDetail} onChange={(e) => setField('usecaseDetail', e.target.value)} style={{ width: '100%' }} />
                </div>
              )}

              <div>
                <label style={labelStyle}>Expense Head *</label>
                <input type="text" className={calcStyles.formControl} placeholder="e.g. Ramesh Traders" value={form.expenseHead} onChange={(e) => setField('expenseHead', e.target.value)} style={{ width: '100%' }} />
              </div>

              <div>
                <label style={labelStyle}>Item Name *</label>
                <select
                  className={calcStyles.formControl}
                  value={form.itemName}
                  onChange={(e) => { setField('itemName', e.target.value); setField('itemSubName', ''); }}
                  disabled={!options}
                  style={{ width: '100%' }}
                >
                  <option value="">Select item…</option>
                  {options?.items.map((i) => <option key={i} value={i}>{i}</option>)}
                </select>
              </div>

              {!!itemSubs?.length && (
                <div>
                  <label style={labelStyle}>{form.itemName} — sub-item *</label>
                  <select className={calcStyles.formControl} value={form.itemSubName} onChange={(e) => setField('itemSubName', e.target.value)} style={{ width: '100%' }}>
                    <option value="">Select…</option>
                    {itemSubs.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              )}

              <div>
                <label style={labelStyle}>Item Qty</label>
                <input type="number" className={calcStyles.formControl} placeholder="Optional" value={form.itemQty} onChange={(e) => setField('itemQty', e.target.value)} min="0" step="0.01" style={{ width: '100%' }} />
              </div>

              <div>
                <label style={labelStyle}>Amount (₹) *</label>
                <input type="number" className={calcStyles.formControl} placeholder="e.g. 4800" value={form.amount} onChange={(e) => setField('amount', e.target.value)} min="0" step="0.01" style={{ width: '100%' }} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button type="submit" className={`${historyStyles.button} ${historyStyles.primary}`} disabled={saving}>
                {saving ? (editId ? 'Updating…' : 'Saving…') : (editId ? 'Update Expense' : 'Save Expense')}
              </button>
              <button type="button" className={historyStyles.button} onClick={() => { resetForm(); setShowForm(false); }}>
                Cancel
              </button>
            </div>
          </form>
        )}

        {!loading && records.length > 0 && (
          <div
            style={{
              display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
              padding: '12px 16px', marginBottom: 12,
              borderRadius: 'var(--mx-radius-xs, 6px)', background: '#f0fdf4', border: '1px solid #bbf7d0'
            }}
          >
            <div style={{ fontSize: '14px' }}>
              <strong>{MONTH_NAMES[month]} {year} total:</strong>{' '}
              <strong style={{ color: '#16a34a' }}>{formatCurrency(total)}</strong>
              <span style={{ color: 'var(--mx-ink-muted)' }}> across {records.length} {records.length === 1 ? 'entry' : 'entries'}</span>
            </div>
            {totalInWords && <div style={{ fontSize: '12.5px', fontStyle: 'italic', color: 'var(--mx-ink-muted)' }}>{totalInWords}</div>}
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--mx-ink-faint)' }}>Loading…</div>
        ) : records.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--mx-ink-faint)', fontSize: '14px' }}>
            No expenses recorded for {MONTH_NAMES[month]} {year}. Click &quot;+ Add Expense&quot; to add the first entry.
          </div>
        ) : (
          <div className={historyStyles.tableWrap}>
            <table className={historyStyles.table}>
              <thead>
                <tr>
                  <th>Sr No.</th>
                  <th>Date</th>
                  <th>Usecase</th>
                  <th>Expense Head</th>
                  <th>Item</th>
                  <th style={{ textAlign: 'right' }}>Qty</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                  <th>Entered By</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.id}>
                    <td style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{formatSrNo(record.sr_no)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDate(record.date)}</td>
                    <td>
                      <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: '12px', fontWeight: 600, background: '#dbeafe', color: '#1e40af' }}>
                        {record.usecase}
                      </span>
                      {record.usecase_detail && (
                        <div style={{ marginTop: 3, fontSize: '12px', color: 'var(--mx-ink-muted)' }}>{record.usecase_detail}</div>
                      )}
                    </td>
                    <td>{record.expense_head || '—'}</td>
                    <td>
                      {record.item_name}
                      {record.item_sub_name && (
                        <div style={{ marginTop: 3, fontSize: '12px', color: 'var(--mx-ink-muted)' }}>{record.item_sub_name}</div>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{record.item_qty ?? '—'}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(record.amount)}</td>
                    <td style={{ whiteSpace: 'nowrap', fontSize: '12.5px', color: 'var(--mx-ink-muted)' }}>{record.creator_name || '—'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          type="button"
                          onClick={() => startEdit(record)}
                          style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--mx-brand, #2563eb)', background: 'transparent', color: 'var(--mx-brand, #2563eb)', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(record)}
                          disabled={deleting === record.id}
                          style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #dc2626', background: 'transparent', color: '#dc2626', fontSize: '12px', fontWeight: 600, cursor: 'pointer', opacity: deleting === record.id ? 0.5 : 1 }}
                        >
                          {deleting === record.id ? '…' : 'Delete'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
