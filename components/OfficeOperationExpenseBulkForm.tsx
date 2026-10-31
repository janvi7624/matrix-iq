'use client';

import { Fragment, useEffect, useState } from 'react';
import { useToast } from './ui/ToastProvider';
import { OFFICE_LOCATIONS, PAID_BY_OPTIONS } from '@/lib/officeOperationExpenseOptions';
import {
  OfficeExpenseOptionsLike,
  OfficeExpenseRow,
  emptyOfficeRow,
  officeRowFlags,
  officeRowIsBlank,
  officeRowToPayload,
  officeRowsTotal,
  validateOfficeRow
} from '@/lib/officeOperationExpenseRow';
import calcStyles from './calculator.module.css';
import historyStyles from './quotationHistory.module.css';
import styles from './officeOperationExpenses.module.css';

// "Add Multiple" for Office Operation Expenses — the counterpart to
// ReimbursementBulkAddForm, which this deliberately mirrors down to the
// table-with-detail-line layout, the per-row error, the carry-forward and
// the partial-save behaviour, so the two feel like one feature rather than
// two solutions to the same problem.
//
// Every validation and encoding rule comes from lib/officeOperationExpenseRow
// — shared with the single-expense page, because the three 'Other'
// substitutions in this module are exactly the kind of thing that would
// quietly drift between two forms.

const INITIAL_ROWS = 5;

interface Props {
  onClose: () => void;
  onSaved: () => void;
}

export default function OfficeOperationExpenseBulkForm({ onClose, onSaved }: Props) {
  const toast = useToast();
  const [options, setOptions] = useState<OfficeExpenseOptionsLike | null>(null);
  const [optionsError, setOptionsError] = useState('');
  const [rows, setRows] = useState<OfficeExpenseRow[]>(() => Array.from({ length: INITIAL_ROWS }, () => emptyOfficeRow()));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/office-operation-expenses/options')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('options'))))
      .then((body: OfficeExpenseOptionsLike) => { if (!cancelled) setOptions(body); })
      .catch(() => { if (!cancelled) setOptionsError('Could not load the expense categories. Reload the page.'); });
    return () => { cancelled = true; };
  }, []);

  function updateRow(key: string, patch: Partial<OfficeExpenseRow>) {
    // Any edit clears that row's error — leaving a stale message beside a
    // field somebody has just corrected reads as "still wrong".
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch, status: 'idle', error: '' } : r)));
  }

  // Changing the expense head invalidates the sub-selection under the old
  // one, so it is cleared rather than silently submitted against the new head.
  function setItemName(key: string, itemName: string) {
    updateRow(key, { itemName, itemSubNames: [], itemSubOther: '', itemFreeTextDetail: '' });
  }

  function setUsecase(key: string, usecase: string) {
    updateRow(key, { usecase, usecaseDetail: '' });
  }

  function toggleSub(key: string, sub: string) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r;
        const has = r.itemSubNames.includes(sub);
        const itemSubNames = has ? r.itemSubNames.filter((s) => s !== sub) : [...r.itemSubNames, sub];
        return { ...r, itemSubNames, itemSubOther: has && sub === 'Other' ? '' : r.itemSubOther, status: 'idle', error: '' };
      })
    );
  }

  function addRows(count: number) {
    setRows((prev) => [...prev, ...Array.from({ length: count }, () => emptyOfficeRow(prev[prev.length - 1]))]);
  }

  function removeRow(key: string) {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== key) : prev));
  }

  const total = officeRowsTotal(rows);
  const filled = rows.filter((r) => !officeRowIsBlank(r));

  async function handleSaveAll() {
    if (!options) return;
    setSaving(true);

    // Rows are posted one at a time and the SURVIVORS are what stays on
    // screen: a batch where row 3 is wrong saves rows 1, 2 and 4 and leaves
    // row 3 with its reason. Making the whole batch fail on one bad row
    // would mean retyping fourteen good ones.
    let savedCount = 0;
    const remaining: OfficeExpenseRow[] = [];

    for (const row of rows) {
      if (officeRowIsBlank(row)) continue;

      const error = validateOfficeRow(row, options);
      if (error) {
        remaining.push({ ...row, status: 'error', error });
        continue;
      }

      try {
        const res = await fetch('/api/office-operation-expenses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(officeRowToPayload(row, options))
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          remaining.push({ ...row, status: 'error', error: body?.error || `Could not save this row (${res.status})` });
        } else {
          savedCount += 1;
        }
      } catch {
        remaining.push({ ...row, status: 'error', error: 'Could not reach the server.' });
      }
    }

    setSaving(false);
    if (savedCount > 0) onSaved();

    if (!remaining.length) {
      toast.success(`${savedCount} expense${savedCount === 1 ? '' : 's'} added.`);
      onClose();
      return;
    }

    // One blank row kept below the failures so the next entry needs no extra click.
    setRows([...remaining, emptyOfficeRow(remaining[remaining.length - 1])]);
    toast.error(
      savedCount > 0
        ? `${savedCount} saved, ${remaining.length} still need attention.`
        : `${remaining.length} row${remaining.length === 1 ? '' : 's'} need attention.`
    );
  }

  if (optionsError) return <div className={historyStyles.loginError}>{optionsError}</div>;
  if (!options) return <div className={calcStyles.sectionPanel}><p className={calcStyles.small}>Loading categories…</p></div>;

  return (
    <div className={calcStyles.sectionPanel}>
      <p className={calcStyles.small}>
        Enter as many expenses as you need and save them in one go. Date, office, category and who paid carry down to each new row —
        change them per row where they differ. A row left completely blank is ignored.
      </p>

      <div className={styles.bulkTableWrap}>
        <table className={styles.bulkTable}>
          <thead>
            <tr>
              <th className={styles.bulkColNum} aria-label="Row" />
              <th className={styles.bulkColDate}>Date</th>
              <th className={styles.bulkColOffice}>Office</th>
              <th className={styles.bulkColUsecase}>Category</th>
              <th className={styles.bulkColItem}>Expense head</th>
              <th className={styles.bulkColQty}>Qty</th>
              <th className={styles.bulkColAmount}>Amount</th>
              <th className={styles.bulkColPaidBy}>Paid by</th>
              <th className={styles.bulkColRemove} aria-label="Remove" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const flags = officeRowFlags(row, options);
              const needsDetailLine =
                !!flags.usecaseSubs ||
                flags.usecaseIsFreeText ||
                !!flags.itemSubs?.length ||
                flags.itemIsFreeText ||
                row.remarks === 'Other' ||
                !!row.description;

              return (
                <Fragment key={row.key}>
                  <tr className={row.status === 'error' ? styles.bulkRowError : undefined}>
                    <td className={styles.bulkColNum}>{index + 1}</td>
                    <td>
                      <input
                        type="date"
                        className={calcStyles.formControl}
                        value={row.date}
                        aria-label={`Row ${index + 1} date`}
                        onChange={(e) => updateRow(row.key, { date: e.target.value })}
                      />
                    </td>
                    <td>
                      <select
                        className={calcStyles.formControl}
                        value={row.officeLocation}
                        aria-label={`Row ${index + 1} office`}
                        onChange={(e) => updateRow(row.key, { officeLocation: e.target.value })}
                      >
                        <option value="">Select…</option>
                        {OFFICE_LOCATIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </td>
                    <td>
                      <select
                        className={calcStyles.formControl}
                        value={row.usecase}
                        aria-label={`Row ${index + 1} category`}
                        onChange={(e) => setUsecase(row.key, e.target.value)}
                      >
                        <option value="">Select…</option>
                        {options.usecases.map((u) => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </td>
                    <td>
                      <select
                        className={calcStyles.formControl}
                        value={row.itemName}
                        aria-label={`Row ${index + 1} expense head`}
                        onChange={(e) => setItemName(row.key, e.target.value)}
                      >
                        <option value="">Select…</option>
                        {options.items.map((i) => <option key={i} value={i}>{i}</option>)}
                      </select>
                    </td>
                    <td>
                      <input
                        type="number"
                        min={1}
                        className={calcStyles.formControl}
                        value={row.itemQty}
                        placeholder="—"
                        aria-label={`Row ${index + 1} quantity`}
                        onChange={(e) => updateRow(row.key, { itemQty: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className={calcStyles.formControl}
                        value={row.amount}
                        aria-label={`Row ${index + 1} amount`}
                        onChange={(e) => updateRow(row.key, { amount: e.target.value })}
                      />
                    </td>
                    <td>
                      <select
                        className={calcStyles.formControl}
                        value={row.remarks}
                        aria-label={`Row ${index + 1} paid by`}
                        onChange={(e) => updateRow(row.key, { remarks: e.target.value, remarksOther: '' })}
                      >
                        <option value="">Select…</option>
                        {PAID_BY_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </td>
                    <td className={styles.bulkColRemove}>
                      <button
                        type="button"
                        className={styles.bulkRemoveBtn}
                        disabled={rows.length === 1}
                        aria-label={`Remove row ${index + 1}`}
                        onClick={() => removeRow(row.key)}
                      >
                        ×
                      </button>
                    </td>
                  </tr>

                  {needsDetailLine && (
                    <tr className={row.status === 'error' ? styles.bulkRowError : undefined}>
                      <td />
                      <td colSpan={8}>
                        <div className={styles.bulkDetailLine}>
                          {flags.usecaseSubs && (
                            <select
                              className={calcStyles.formControl}
                              value={row.usecaseDetail}
                              aria-label={`Row ${index + 1} ${row.usecase} detail`}
                              onChange={(e) => updateRow(row.key, { usecaseDetail: e.target.value })}
                            >
                              <option value="">Which {row.usecase.toLowerCase()}?</option>
                              {flags.usecaseSubs.map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                          )}
                          {flags.usecaseIsFreeText && (
                            <input
                              className={calcStyles.formControl}
                              value={row.usecaseDetail}
                              placeholder="Describe the category"
                              aria-label={`Row ${index + 1} category description`}
                              onChange={(e) => updateRow(row.key, { usecaseDetail: e.target.value })}
                            />
                          )}

                          {/* A free-text head (Maintenance, Rent) has no list —
                              its whole sub-selection is this one description. */}
                          {flags.itemIsFreeText && (
                            <input
                              className={calcStyles.formControl}
                              value={row.itemFreeTextDetail}
                              placeholder={`Describe the ${row.itemName} expense`}
                              aria-label={`Row ${index + 1} ${row.itemName} description`}
                              onChange={(e) => updateRow(row.key, { itemFreeTextDetail: e.target.value })}
                            />
                          )}

                          {!flags.itemIsFreeText && !!flags.itemSubs?.length && (
                            <div className={styles.bulkSubChips}>
                              {flags.itemSubs.map((sub) => (
                                <label key={sub} className={styles.bulkSubChip}>
                                  <input
                                    type="checkbox"
                                    checked={row.itemSubNames.includes(sub)}
                                    onChange={() => toggleSub(row.key, sub)}
                                  />
                                  {sub}
                                </label>
                              ))}
                            </div>
                          )}
                          {row.itemSubNames.includes('Other') && (
                            <input
                              className={calcStyles.formControl}
                              value={row.itemSubOther}
                              placeholder={`Describe the "Other" ${row.itemName} item`}
                              aria-label={`Row ${index + 1} other item description`}
                              onChange={(e) => updateRow(row.key, { itemSubOther: e.target.value })}
                            />
                          )}

                          {row.remarks === 'Other' && (
                            <input
                              className={calcStyles.formControl}
                              value={row.remarksOther}
                              placeholder="Who paid?"
                              aria-label={`Row ${index + 1} payer name`}
                              onChange={(e) => updateRow(row.key, { remarksOther: e.target.value })}
                            />
                          )}

                          <input
                            className={calcStyles.formControl}
                            value={row.description}
                            placeholder="Note (optional)"
                            aria-label={`Row ${index + 1} note`}
                            onChange={(e) => updateRow(row.key, { description: e.target.value })}
                          />
                        </div>
                        {row.error && <div className={styles.bulkRowErrorText}>{row.error}</div>}
                      </td>
                    </tr>
                  )}

                  {/* A row with no detail line still needs somewhere to show
                      its error, or a rejected row would look accepted. */}
                  {!needsDetailLine && row.error && (
                    <tr className={styles.bulkRowError}>
                      <td />
                      <td colSpan={8}><div className={styles.bulkRowErrorText}>{row.error}</div></td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className={styles.bulkFooterRow}>
        <button type="button" className={historyStyles.button} onClick={() => addRows(1)}>+ Add Row</button>
        <button type="button" className={historyStyles.button} onClick={() => addRows(5)}>+ Add 5 Rows</button>
        <span className={styles.bulkTotalText}>
          {filled.length > 0 && (
            <>Running total: <strong>₹{total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong></>
          )}
        </span>
      </div>

      <div className={styles.bulkSubmitRow}>
        <button
          type="button"
          className={calcStyles.btn}
          disabled={saving || filled.length === 0}
          onClick={handleSaveAll}
        >
          {saving ? 'Saving…' : `Save All${filled.length > 0 ? ` (${filled.length})` : ''}`}
        </button>
        <button type="button" className={historyStyles.button} disabled={saving} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
