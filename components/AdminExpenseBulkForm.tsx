'use client';

import { Fragment, useEffect, useState } from 'react';
import { useToast } from './ui/ToastProvider';
import { UNALLOCATED_EMPLOYEE_ID } from '@/lib/adminExpenseUnallocated';
import {
  ADMIN_EXPENSE_TYPES,
  AdminExpenseRow,
  adminRowDays,
  adminRowFlags,
  adminRowIsBlank,
  adminRowToPayload,
  adminRowsTotal,
  emptyAdminRow,
  validateAdminRow
} from '@/lib/adminExpenseRow';
import type { UserOption } from './AdminExpensesView';
import calcStyles from './calculator.module.css';
import historyStyles from './quotationHistory.module.css';
import styles from './adminExpenses.module.css';

// "Add Multiple" for Admin Expenses — the same shape as
// ReimbursementBulkAddForm and OfficeOperationExpenseBulkForm.
//
// An Admin Expense is one cost split across several employees, so each row
// already carries a list of people. The employee list therefore sits on the
// detail line rather than in a column: it is the widest thing on the row and
// the one most often identical down the batch, which is why emptyAdminRow
// carries it forward.
//
// Every rule about which fields a type needs lives in lib/adminExpenseRow,
// shared with the single-expense page.

const INITIAL_ROWS = 4;

interface Props {
  onClose: () => void;
  onSaved: () => void;
}

export default function AdminExpenseBulkForm({ onClose, onSaved }: Props) {
  const toast = useToast();
  const [users, setUsers] = useState<UserOption[]>([]);
  const [rows, setRows] = useState<AdminExpenseRow[]>(() => Array.from({ length: INITIAL_ROWS }, () => emptyAdminRow()));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/users/lite')
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => { if (!cancelled) setUsers(Array.isArray(data) ? data : []); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  function updateRow(key: string, patch: Partial<AdminExpenseRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch, status: 'idle', error: '' } : r)));
  }

  // Switching type changes which fields even apply, so the ones that no
  // longer do are cleared rather than submitted invisibly against the new
  // type — a leftover check-out date on a bus ticket would be stored.
  function setType(key: string, type: string) {
    updateRow(key, {
      type,
      date: '',
      checkInDate: '',
      checkOutDate: '',
      location: '',
      fromLocation: '',
      toLocation: '',
      otherType: '',
      flightTripType: 'one_way'
    });
  }

  function toggleEmployee(key: string, userId: string) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r;
        const has = r.employeeIds.includes(userId);
        return {
          ...r,
          employeeIds: has ? r.employeeIds.filter((id) => id !== userId) : [...r.employeeIds, userId],
          status: 'idle',
          error: ''
        };
      })
    );
  }

  function addRows(count: number) {
    setRows((prev) => [...prev, ...Array.from({ length: count }, () => emptyAdminRow(prev[prev.length - 1]))]);
  }

  function removeRow(key: string) {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== key) : prev));
  }

  const total = adminRowsTotal(rows);
  const filled = rows.filter((r) => !adminRowIsBlank(r));

  async function handleSaveAll() {
    setSaving(true);

    // Per-row posting, survivors stay on screen — one bad row must not cost
    // the operator the other nine.
    let savedCount = 0;
    const remaining: AdminExpenseRow[] = [];

    for (const row of rows) {
      if (adminRowIsBlank(row)) continue;

      const error = validateAdminRow(row);
      if (error) {
        remaining.push({ ...row, status: 'error', error });
        continue;
      }

      try {
        const res = await fetch('/api/admin-expenses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(adminRowToPayload(row))
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

    setRows([...remaining, emptyAdminRow(remaining[remaining.length - 1])]);
    toast.error(
      savedCount > 0
        ? `${savedCount} saved, ${remaining.length} still need attention.`
        : `${remaining.length} row${remaining.length === 1 ? '' : 's'} need attention.`
    );
  }

  return (
    <div className={calcStyles.sectionPanel}>
      <p className={calcStyles.small}>
        Enter several expenses and save them together. The date and the selected employees carry down to each new row — a trip&apos;s
        hotel and tickets usually share both. A row left completely blank is ignored.
      </p>

      <div className={styles.bulkTableWrap}>
        <table className={styles.bulkTable}>
          <thead>
            <tr>
              <th className={styles.bulkColNum} aria-label="Row" />
              <th className={styles.bulkColType}>Type</th>
              <th className={styles.bulkColDate}>Date</th>
              <th className={styles.bulkColWhere}>Where</th>
              <th className={styles.bulkColAmount}>Amount</th>
              <th className={styles.bulkColRemove} aria-label="Remove" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const flags = adminRowFlags(row);
              const nights = flags.isHotel ? adminRowDays(row.checkInDate, row.checkOutDate) : 0;
              const returnGap = flags.isReturnFlight ? adminRowDays(row.date, row.checkOutDate) : 0;

              return (
                <Fragment key={row.key}>
                  <tr className={row.status === 'error' ? styles.bulkRowError : undefined}>
                    <td className={styles.bulkColNum}>{index + 1}</td>
                    <td>
                      <select
                        className={calcStyles.formControl}
                        value={row.type}
                        aria-label={`Row ${index + 1} expense type`}
                        onChange={(e) => setType(row.key, e.target.value)}
                      >
                        <option value="">Select…</option>
                        {ADMIN_EXPENSE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </td>
                    <td>
                      {/* Hotel has no single date — it has a stay, entered on
                          the detail line below. */}
                      {flags.isHotel ? (
                        <span className={calcStyles.small}>Stay dates below</span>
                      ) : (
                        <input
                          type="date"
                          className={calcStyles.formControl}
                          value={row.date}
                          aria-label={`Row ${index + 1} date`}
                          onChange={(e) => updateRow(row.key, { date: e.target.value })}
                        />
                      )}
                    </td>
                    <td>
                      {flags.isTicket ? (
                        <div className={styles.bulkInlinePair}>
                          <input
                            className={calcStyles.formControl}
                            value={row.fromLocation}
                            placeholder="From"
                            aria-label={`Row ${index + 1} from`}
                            onChange={(e) => updateRow(row.key, { fromLocation: e.target.value })}
                          />
                          <input
                            className={calcStyles.formControl}
                            value={row.toLocation}
                            placeholder="To"
                            aria-label={`Row ${index + 1} to`}
                            onChange={(e) => updateRow(row.key, { toLocation: e.target.value })}
                          />
                        </div>
                      ) : row.type ? (
                        <input
                          className={calcStyles.formControl}
                          value={row.location}
                          placeholder={flags.isHotel ? 'Hotel city' : 'Location'}
                          aria-label={`Row ${index + 1} location`}
                          onChange={(e) => updateRow(row.key, { location: e.target.value })}
                        />
                      ) : (
                        <span className={calcStyles.small}>—</span>
                      )}
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className={calcStyles.formControl}
                        value={row.totalAmount}
                        aria-label={`Row ${index + 1} amount`}
                        onChange={(e) => updateRow(row.key, { totalAmount: e.target.value })}
                      />
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

                  <tr className={row.status === 'error' ? styles.bulkRowError : undefined}>
                    <td />
                    <td colSpan={5}>
                      <div className={styles.bulkDetailLine}>
                        {flags.isHotel && (
                          <>
                            <input
                              type="date"
                              className={calcStyles.formControl}
                              value={row.checkInDate}
                              aria-label={`Row ${index + 1} check-in`}
                              onChange={(e) => updateRow(row.key, { checkInDate: e.target.value })}
                            />
                            <input
                              type="date"
                              className={calcStyles.formControl}
                              value={row.checkOutDate}
                              aria-label={`Row ${index + 1} check-out`}
                              onChange={(e) => updateRow(row.key, { checkOutDate: e.target.value })}
                            />
                            {nights > 0 && <span className={calcStyles.small}>{nights} night{nights === 1 ? '' : 's'}</span>}
                          </>
                        )}

                        {flags.isFlight && (
                          <>
                            <select
                              className={calcStyles.formControl}
                              value={row.flightTripType}
                              aria-label={`Row ${index + 1} trip type`}
                              onChange={(e) =>
                                updateRow(row.key, {
                                  flightTripType: e.target.value as AdminExpenseRow['flightTripType'],
                                  // A one-way flight has no return date, and
                                  // leaving a stale one would be submitted.
                                  checkOutDate: e.target.value === 'return' ? row.checkOutDate : ''
                                })
                              }
                            >
                              <option value="one_way">One way</option>
                              <option value="return">Return</option>
                            </select>
                            {flags.isReturnFlight && (
                              <>
                                <input
                                  type="date"
                                  className={calcStyles.formControl}
                                  value={row.checkOutDate}
                                  aria-label={`Row ${index + 1} return date`}
                                  onChange={(e) => updateRow(row.key, { checkOutDate: e.target.value })}
                                />
                                {row.date && row.checkOutDate && (
                                  <span className={calcStyles.small}>
                                    {returnGap === 0 ? 'Same-day return' : `Returns after ${returnGap} day${returnGap === 1 ? '' : 's'}`}
                                  </span>
                                )}
                              </>
                            )}
                          </>
                        )}

                        {flags.isOther && (
                          <input
                            className={calcStyles.formControl}
                            value={row.otherType}
                            placeholder="What kind of expense?"
                            aria-label={`Row ${index + 1} expense label`}
                            onChange={(e) => updateRow(row.key, { otherType: e.target.value })}
                          />
                        )}

                        <div className={styles.bulkEmployeeChips}>
                          <label className={styles.bulkEmployeeChip}>
                            <input
                              type="checkbox"
                              checked={row.employeeIds.includes(UNALLOCATED_EMPLOYEE_ID)}
                              onChange={() => toggleEmployee(row.key, UNALLOCATED_EMPLOYEE_ID)}
                            />
                            Other / Unallocated
                          </label>
                          {users.map((u) => (
                            <label key={u.id} className={styles.bulkEmployeeChip}>
                              <input
                                type="checkbox"
                                checked={row.employeeIds.includes(u.id)}
                                onChange={() => toggleEmployee(row.key, u.id)}
                              />
                              {u.name || u.username}
                            </label>
                          ))}
                        </div>
                      </div>
                      {row.error && <div className={styles.bulkRowErrorText}>{row.error}</div>}
                    </td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className={styles.bulkFooterRow}>
        <button type="button" className={historyStyles.button} onClick={() => addRows(1)}>+ Add Row</button>
        <button type="button" className={historyStyles.button} onClick={() => addRows(4)}>+ Add 4 Rows</button>
        <span className={styles.bulkTotalText}>
          {filled.length > 0 && (
            <>Running total: <strong>₹{total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong></>
          )}
        </span>
      </div>

      <div className={styles.bulkSubmitRow}>
        <button type="button" className={calcStyles.btn} disabled={saving || filled.length === 0} onClick={handleSaveAll}>
          {saving ? 'Saving…' : `Save All${filled.length > 0 ? ` (${filled.length})` : ''}`}
        </button>
        <button type="button" className={historyStyles.button} disabled={saving} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
