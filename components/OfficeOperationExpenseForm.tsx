'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from './AppShell';
import { useToast } from './ui/ToastProvider';
import { OfficeOperationExpenseRecord } from '@/lib/types';
import { OFFICE_LOCATIONS, PAID_BY_OPTIONS } from '@/lib/officeOperationExpenseOptions';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import styles from './officeOperationExpenses.module.css';

interface OptionsPayload {
  usecases: string[];
  usecaseSubOptions: Record<string, string[]>;
  usecaseFreeText: string;
  items: string[];
  itemSubOptions: Record<string, string[]>;
  itemFreeTextItems: string[];
}

const emptyForm = {
  date: '',
  officeLocation: '',
  usecase: '',
  usecaseDetail: '',
  itemName: '',
  itemSubNames: [] as string[],
  // Only used while itemSubNames includes 'Other' — the typed description
  // that replaces the literal "Other" in what's actually submitted, same
  // pattern as remarksOther below.
  itemSubOther: '',
  // Only used while itemName is one of ITEM_FREE_TEXT_ITEMS (Maintenance,
  // Rent) — the whole sub-selection is this one typed description rather
  // than a checkbox list. See handleSubmit.
  itemFreeTextDetail: '',
  itemQty: '',
  amount: '',
  description: '',
  remarks: '',
  // Only used while `remarks === 'Other'` — the typed name that becomes the
  // real submitted value (see handleSubmit).
  remarksOther: ''
};

/** Reopens a stored record as the form fields that would have produced it — same reasoning as the submit-time encoding below, run in reverse. */
function buildFormFromRecord(record: OfficeOperationExpenseRecord, options: OptionsPayload): typeof emptyForm {
  const isNamedOption = (PAID_BY_OPTIONS as readonly string[]).includes(record.remarks) && record.remarks !== 'Other';
  const knownSubs = options.itemSubOptions[record.item_name] ?? [];
  const customSub = record.item_sub_names.find((n) => !knownSubs.includes(n));
  const isFreeTextItem = options.itemFreeTextItems.includes(record.item_name);
  return {
    date: record.date,
    officeLocation: record.office_location,
    usecase: record.usecase,
    usecaseDetail: record.usecase_detail,
    itemName: record.item_name,
    itemSubNames: isFreeTextItem
      ? []
      : customSub
        ? record.item_sub_names.map((n) => (n === customSub ? 'Other' : n))
        : record.item_sub_names,
    itemSubOther: !isFreeTextItem ? (customSub ?? '') : '',
    itemFreeTextDetail: isFreeTextItem ? (record.item_sub_names[0] ?? '') : '',
    itemQty: record.item_qty === null ? '' : String(record.item_qty),
    amount: String(record.amount),
    description: record.description,
    remarks: isNamedOption ? record.remarks : record.remarks ? 'Other' : '',
    remarksOther: isNamedOption ? '' : record.remarks
  };
}

interface OfficeOperationExpenseFormProps {
  /** Present only when editing an existing expense. */
  editId?: string;
}

export default function OfficeOperationExpenseForm({ editId }: OfficeOperationExpenseFormProps) {
  const router = useRouter();
  const toast = useToast();

  const [options, setOptions] = useState<OptionsPayload | null>(null);
  const [record, setRecord] = useState<OfficeOperationExpenseRecord | null>(null);
  // Blocks the form until an edit's record has actually loaded — otherwise a
  // brand-new emptyForm would flash before the real values arrive.
  const [loadingRecord, setLoadingRecord] = useState(!!editId);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const setField = useCallback(<K extends keyof typeof emptyForm>(key: K, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  // Sub-items are multi-select, so this toggles one value in or out of the list.
  const toggleSubItem = useCallback((value: string) => {
    setForm((prev) => {
      const nowOn = !prev.itemSubNames.includes(value);
      return {
        ...prev,
        itemSubNames: nowOn ? [...prev.itemSubNames, value] : prev.itemSubNames.filter((v) => v !== value),
        // Unchecking 'Other' clears its typed description too, so a stale
        // answer can't survive being deselected and then re-checked blank.
        itemSubOther: value === 'Other' && !nowOn ? '' : prev.itemSubOther
      };
    });
  }, []);

  // Which second-level fields the current selections call for. Driven entirely
  // by the server's option payload.
  const usecaseSubs = options && form.usecase ? options.usecaseSubOptions[form.usecase] : undefined;
  const usecaseIsFreeText = !!options && form.usecase === options.usecaseFreeText;
  const itemSubs = options && form.itemName ? options.itemSubOptions[form.itemName] : undefined;
  const itemIsFreeTextSelected = !!options && !!form.itemName && options.itemFreeTextItems.includes(form.itemName);

  useEffect(() => {
    fetch('/api/office-operation-expenses/options')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data) setOptions(data); })
      .catch(() => { /* form falls back to disabled selects until this succeeds */ });
  }, []);

  useEffect(() => {
    if (!editId) return;
    let cancelled = false;
    fetch(`/api/office-operation-expenses/${editId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (!data) {
          toast.error('That expense could not be found');
          router.push('/office-operation-expenses');
          return;
        }
        setRecord(data);
      })
      .catch(() => {
        if (cancelled) return;
        toast.error('Failed to load the expense');
        router.push('/office-operation-expenses');
      })
      .finally(() => { if (!cancelled) setLoadingRecord(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  // Re-opening a stored record needs the known sub-item/free-text lists from
  // `options` to tell a plain value apart from a typed 'Other' — wait for
  // both before building the form.
  useEffect(() => {
    if (record && options) setForm(buildFormFromRecord(record, options));
  }, [record, options]);

  function goBack() {
    router.push('/office-operation-expenses');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!form.date) { toast.error('Select a date'); return; }
    if (!form.officeLocation) { toast.error('Select the office location'); return; }
    if (!form.usecase) { toast.error('Select a category'); return; }
    if (usecaseSubs && !form.usecaseDetail) { toast.error(`Select which ${form.usecase.toLowerCase()} this is`); return; }
    if (usecaseIsFreeText && !form.usecaseDetail.trim()) { toast.error('Describe the category'); return; }
    if (!form.itemName) { toast.error('Select an expense head'); return; }
    if (itemSubs?.length && !form.itemSubNames.length) { toast.error(form.itemName === 'Department' ? 'Select at least one department' : `Select at least one Item Name for ${form.itemName}`); return; }
    if (form.itemSubNames.includes('Other') && !form.itemSubOther.trim()) { toast.error(`Describe the "Other" ${form.itemName} item`); return; }
    if (itemIsFreeTextSelected && !form.itemFreeTextDetail.trim()) { toast.error(`Describe the ${form.itemName} expense`); return; }
    if (!form.remarks) { toast.error('Select who paid'); return; }
    if (form.remarks === 'Other' && !form.remarksOther.trim()) { toast.error('Enter the name of who paid'); return; }
    // Qty is optional — only complain when something was typed and it's not a
    // usable number.
    if (form.itemQty.trim() && !(Number(form.itemQty) > 0)) { toast.error('Item Qty must be greater than zero'); return; }
    if (!(Number(form.amount) > 0)) { toast.error('Amount must be greater than zero'); return; }

    setSaving(true);
    try {
      const payload = {
        date: form.date,
        officeLocation: form.officeLocation,
        usecase: form.usecase,
        usecaseDetail: usecaseSubs || usecaseIsFreeText ? form.usecaseDetail : '',
        itemName: form.itemName,
        itemSubNames: itemIsFreeTextSelected
          ? [form.itemFreeTextDetail.trim()]
          : // 'Other' itself is never stored — same reasoning as remarks below —
            // the typed description replaces it so the register reads what the
            // item actually was, not the literal word "Other".
            itemSubs?.length
            ? form.itemSubNames.map((n) => (n === 'Other' ? form.itemSubOther.trim() : n))
            : [],
        // Empty string, not 0 — the server reads '' as "not specified" and
        // stores NULL, whereas 0 would fail its positive-number check.
        itemQty: form.itemQty.trim(),
        amount: Number(form.amount),
        description: form.description,
        // 'Other' itself is never stored — the typed name is what Paid By
        // actually means in that case.
        remarks: form.remarks === 'Other' ? form.remarksOther.trim() : form.remarks
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

      toast.success(editId ? 'Expense updated' : 'Expense saved');
      router.push('/office-operation-expenses');
    } catch {
      toast.error('Network error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell title={editId ? 'Edit Expense' : 'Add Expense'} subtitle="HR/Admin office operating expense register">
      <div className={styles.pageWrap}>
        <div className={styles.headerRow}>
          <h2 className={styles.pageTitle}>{editId ? 'Edit Expense' : 'Add Expense'}</h2>
          <button type="button" className={historyStyles.button} onClick={goBack}>
            ← Back to register
          </button>
        </div>

        {loadingRecord ? (
          <div className={styles.loadingState}>Loading…</div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className={styles.editingNote}>
              {editId
                ? <>Editing Sr No. is fixed — the serial never changes once assigned.</>
                : <>Sr No. is assigned automatically when you save.</>}
            </div>

            <div className={styles.formGrid}>
              <div>
                <label className={styles.fieldLabel}>Date *</label>
                <input type="date" className={`${calcStyles.formControl} ${styles.fullWidth}`} value={form.date} onChange={(e) => setField('date', e.target.value)} />
              </div>

              <div>
                <label className={styles.fieldLabel}>Office Location *</label>
                <div className={historyStyles.modeToggle} role="radiogroup" aria-label="Office Location">
                  {OFFICE_LOCATIONS.map((loc) => (
                    <button
                      key={loc}
                      type="button"
                      role="radio"
                      aria-checked={form.officeLocation === loc}
                      className={`${historyStyles.modeToggleBtn} ${form.officeLocation === loc ? historyStyles.modeToggleBtnActive : ''}`}
                      onClick={() => setField('officeLocation', loc)}
                    >
                      {loc}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className={styles.fieldLabel}>Category *</label>
                <select
                  className={`${calcStyles.formControl} ${styles.fullWidth}`}
                  value={form.usecase}
                  onChange={(e) => { setField('usecase', e.target.value); setField('usecaseDetail', ''); }}
                  disabled={!options}
                >
                  <option value="">Select category…</option>
                  {options?.usecases.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>

              {usecaseSubs && (
                <div>
                  <label className={styles.fieldLabel}>{form.usecase} — which one? *</label>
                  <select className={`${calcStyles.formControl} ${styles.fullWidth}`} value={form.usecaseDetail} onChange={(e) => setField('usecaseDetail', e.target.value)}>
                    <option value="">Select…</option>
                    {usecaseSubs.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              )}

              {usecaseIsFreeText && (
                <div>
                  <label className={styles.fieldLabel}>Specify category *</label>
                  <input type="text" className={calcStyles.formControl} placeholder="e.g. Annual audit" value={form.usecaseDetail} onChange={(e) => setField('usecaseDetail', e.target.value)} style={{ width: '100%' }} />
                </div>
              )}

              <div>
                <label className={styles.fieldLabel}>Expense Head *</label>
                <select
                  className={`${calcStyles.formControl} ${styles.fullWidth}`}
                  value={form.itemName}
                  onChange={(e) => { setField('itemName', e.target.value); setForm((prev) => ({ ...prev, itemSubNames: [], itemSubOther: '', itemFreeTextDetail: '' })); }}
                  disabled={!options}
                >
                  <option value="">Select expense head…</option>
                  {options?.items.map((i) => <option key={i} value={i}>{i}</option>)}
                </select>
              </div>

              {!!itemSubs?.length && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <label className={styles.fieldLabel}>
                    {form.itemName === 'Department' ? 'Departments' : `${form.itemName} — Item Names`} *
                    {form.itemSubNames.length > 0 && ` · ${form.itemSubNames.length} selected`}
                  </label>
                  <div style={{
                    display: 'flex', flexWrap: 'wrap', gap: 6, padding: 10,
                    border: '1px solid var(--mx-border, #e5e7eb)', borderRadius: 'var(--mx-radius-xs, 6px)',
                    background: 'var(--mx-surface, #fff)', maxHeight: 190, overflowY: 'auto'
                  }}>
                    {itemSubs.map((sub) => {
                      const on = form.itemSubNames.includes(sub);
                      return (
                        <label key={sub} style={{
                          display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                          padding: '4px 10px', borderRadius: 14, fontSize: '13px', userSelect: 'none',
                          border: `1px solid ${on ? 'var(--mx-brand, #2563eb)' : 'var(--mx-border, #e5e7eb)'}`,
                          background: on ? 'var(--mx-brand-subtle, #eff6ff)' : 'transparent',
                          color: on ? 'var(--mx-brand, #2563eb)' : 'var(--mx-ink)',
                          fontWeight: on ? 600 : 400
                        }}>
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => toggleSubItem(sub)}
                            style={{ accentColor: 'var(--mx-brand, #2563eb)', margin: 0 }}
                          />
                          {sub}
                        </label>
                      );
                    })}
                  </div>
                  {form.itemSubNames.includes('Other') && (
                    <input
                      type="text"
                      className={`${calcStyles.formControl} ${styles.fullWidth}`}
                      placeholder="What is it?"
                      value={form.itemSubOther}
                      onChange={(e) => setField('itemSubOther', e.target.value)}
                      style={{ marginTop: 8 }}
                    />
                  )}
                </div>
              )}

              {itemIsFreeTextSelected && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <label className={styles.fieldLabel}>{form.itemName} — what is it? *</label>
                  <input
                    type="text"
                    className={`${calcStyles.formControl} ${styles.fullWidth}`}
                    placeholder={
                      form.itemName === 'Rent'
                        ? 'e.g. October office rent'
                        : form.itemName === 'Maintenance'
                          ? 'e.g. AC servicing, plumbing repair'
                          : 'Describe what this was for'
                    }
                    value={form.itemFreeTextDetail}
                    onChange={(e) => setField('itemFreeTextDetail', e.target.value)}
                  />
                </div>
              )}

              <div>
                <label className={styles.fieldLabel}>Item Qty</label>
                <input type="number" className={`${calcStyles.formControl} ${styles.fullWidth}`} placeholder="Optional" value={form.itemQty} onChange={(e) => setField('itemQty', e.target.value)} min="0" step="0.01" />
              </div>

              <div>
                <label className={styles.fieldLabel}>Amount (₹) *</label>
                <input type="number" className={`${calcStyles.formControl} ${styles.fullWidth}`} placeholder="e.g. 4800" value={form.amount} onChange={(e) => setField('amount', e.target.value)} min="0" step="0.01" />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16, marginBottom: 16 }}>
              <div>
                <label className={styles.fieldLabel}>Description</label>
                <textarea className={calcStyles.formControl} rows={2} placeholder="What was purchased or paid for" value={form.description} onChange={(e) => setField('description', e.target.value)} style={{ width: '100%', resize: 'vertical' }} />
              </div>
              <div>
                <label className={styles.fieldLabel}>Paid By *</label>
                <select
                  className={`${calcStyles.formControl} ${styles.fullWidth}`}
                  value={form.remarks}
                  onChange={(e) => { setField('remarks', e.target.value); if (e.target.value !== 'Other') setField('remarksOther', ''); }}
                >
                  <option value="">Select who paid…</option>
                  {PAID_BY_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                {form.remarks === 'Other' && (
                  <input
                    className={`${calcStyles.formControl} ${styles.fullWidth}`}
                    placeholder="Enter name *"
                    value={form.remarksOther}
                    onChange={(e) => setField('remarksOther', e.target.value)}
                    style={{ marginTop: 8 }}
                  />
                )}
              </div>
            </div>

            <div className={styles.formActions}>
              <button type="submit" className={`${historyStyles.button} ${historyStyles.primary}`} disabled={saving}>
                {saving ? (editId ? 'Updating…' : 'Saving…') : (editId ? 'Update Expense' : 'Save Expense')}
              </button>
              <button type="button" className={historyStyles.button} onClick={goBack} disabled={saving}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </AppShell>
  );
}
