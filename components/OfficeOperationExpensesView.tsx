'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from './AppShell';
import { useToast } from './ui/ToastProvider';
import ExpenseCategoryEditor from './ExpenseCategoryEditor';
import OfficeOperationExpenseBulkForm from './OfficeOperationExpenseBulkForm';
import { OfficeOperationExpenseRecord } from '@/lib/types';
import { exportOfficeOperationExpensesXlsx } from '@/lib/officeOperationExpenseXlsx';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import styles from './officeOperationExpenses.module.css';

const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

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

interface OfficeOperationExpensesViewProps {
  // Only the name is used — it stamps "Prepared By" on the Excel sheet.
  currentUser: { name: string };
}

export default function OfficeOperationExpensesView({ currentUser }: OfficeOperationExpensesViewProps) {
  const toast = useToast();
  const router = useRouter();
  const now = useMemo(() => new Date(), []);

  const [records, setRecords] = useState<OfficeOperationExpenseRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [totalInWords, setTotalInWords] = useState('');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  // Custom range, off by default so the filter opens on the single month it
  // always has and the To selects stay out of the way until asked for.
  //
  // In single-month mode the range's two ends are BOTH (year, month) — see
  // rangeToYear/rangeToMonth below. That is deliberate: the query, the total
  // label and the export then have one code path rather than a month path and
  // a range path that can drift apart.
  const [rangeMode, setRangeMode] = useState(false);
  const [toYear, setToYear] = useState(now.getFullYear());
  const [toMonth, setToMonth] = useState(now.getMonth() + 1);

  const [loading, setLoading] = useState(true);
  // True once a fetch has completed at least once. Only the very first load
  // shows the blank "Loading…" placeholder; a month/year change afterward
  // keeps the current table on screen (dimmed) instead of collapsing it to
  // that ~100px placeholder and then springing back out to full height —
  // that collapse-then-reexpand on every filter change is what reads as the
  // whole page "vibrating" when someone clicks through several months.
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  // Deliberately does NOT flip `loading` on at the top: this runs from the
  // month/year effect below, and a synchronous setState in an effect body
  // triggers the cascading-render pattern react-hooks/set-state-in-effect
  // rejects. `loading` starts true for the first load and is turned back on by
  // the filter handlers (a user event, where setState is fine) instead.
  //
  // requestIdRef guards against out-of-order responses: clicking through a
  // couple of months before the first request has returned fires several
  // fetches in flight at once, and nothing otherwise stops a slower, now-
  // superseded response from landing last and overwriting the screen with
  // the wrong month's rows right after the right ones briefly appeared —
  // which is exactly what reads as the table flickering/"vibrating". Only
  // the response whose requestId still matches the latest one issued is
  // allowed to touch state; every earlier one is a silent no-op.
  const requestIdRef = useRef(0);

  const fetchRecords = useCallback(async (fromY: number, fromM: number, toY: number, toM: number) => {
    const requestId = ++requestIdRef.current;
    try {
      const res = await fetch(
        `/api/office-operation-expenses?fromYear=${fromY}&fromMonth=${fromM}&toYear=${toY}&toMonth=${toM}`
      );
      const data = await res.json().catch(() => null);
      if (requestId !== requestIdRef.current) return;
      if (!res.ok) {
        toast.error(data?.error || `Failed to load expenses (${res.status})`);
        return;
      }
      setRecords(data.records || []);
      setTotal(data.total || 0);
      setTotalInWords(data.totalInWords || '');
    } catch {
      if (requestId !== requestIdRef.current) return;
      toast.error('Network error while loading expenses');
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setHasLoadedOnce(true);
      }
    }
  }, [toast]);

  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);

  // The far end of the period actually queried: the To selects in range mode,
  // and the From month itself otherwise. Everything downstream — the fetch,
  // the total label, the export, the after-save jump — reads these rather
  // than branching on rangeMode.
  const rangeToYear = rangeMode ? toYear : year;
  const rangeToMonth = rangeMode ? toMonth : month;

  // "October 2026", or "August 2026 – October 2026" once the period spans more
  // than one month. Equal ends read as the single month, so switching the
  // range on without widening it leaves the heading alone.
  const periodLabel =
    rangeToYear === year && rangeToMonth === month
      ? `${MONTH_NAMES[month]} ${year}`
      : `${MONTH_NAMES[month]} ${year} – ${MONTH_NAMES[rangeToMonth]} ${rangeToYear}`;

  useEffect(() => {
    // fetchRecords has no synchronous setState — every setState in it runs
    // after an `await` or in `finally` — but the rule can't see through the
    // async boundary and flags any reachable setState. Suppressed rather than
    // restructured because reloading on a filter change IS effect work.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchRecords(year, month, rangeToYear, rangeToMonth);
  }, [year, month, rangeToYear, rangeToMonth, fetchRecords]);

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
      await fetchRecords(year, month, rangeToYear, rangeToMonth);
    } catch {
      toast.error('Network error');
    } finally {
      setDeleting(null);
    }
  }

  async function handleExport() {
    if (!records.length) { toast.error('Nothing to export for this period'); return; }
    try {
      await exportOfficeOperationExpensesXlsx({
        records, total, totalInWords, year, month,
        // Equal to year/month on a single month, which the sheet treats as
        // exactly the month export it has always produced.
        toYear: rangeToYear, toMonth: rangeToMonth,
        preparedBy: currentUser.name
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
      {categoriesOpen && (
        <ExpenseCategoryEditor
          onClose={() => setCategoriesOpen(false)}
          onSaved={() => { /* the Add/Edit page fetches its own fresh options on every mount */ }}
        />
      )}
      <div className={styles.pageWrap}>
        <div className={styles.headerRow}>
          <h2 className={styles.pageTitle}>Office Operation Expenses</h2>
          <div className={styles.filterRow}>
            <select className={calcStyles.formControl} value={month} onChange={(e) => { setLoading(true); setMonth(Number(e.target.value)); }} aria-label={rangeMode ? 'From month' : 'Month'}>
              {MONTH_NAMES.slice(1).map((name, i) => <option key={name} value={i + 1}>{name}</option>)}
            </select>
            <select className={calcStyles.formControl} value={year} onChange={(e) => { setLoading(true); setYear(Number(e.target.value)); }} aria-label={rangeMode ? 'From year' : 'Year'}>
              {yearChoices.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            {rangeMode && (
              <>
                <span className={styles.mutedText}>to</span>
                <select className={calcStyles.formControl} value={toMonth} onChange={(e) => { setLoading(true); setToMonth(Number(e.target.value)); }} aria-label="To month">
                  {MONTH_NAMES.slice(1).map((name, i) => <option key={name} value={i + 1}>{name}</option>)}
                </select>
                <select className={calcStyles.formControl} value={toYear} onChange={(e) => { setLoading(true); setToYear(Number(e.target.value)); }} aria-label="To year">
                  {yearChoices.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </>
            )}
            <button
              type="button"
              className={historyStyles.button}
              onClick={() => {
                setLoading(true);
                if (rangeMode) {
                  setRangeMode(false);
                } else {
                  // Seed the far end to the month already on screen, so
                  // switching on shows the SAME rows rather than silently
                  // widening the period the moment it is clicked. Widening is
                  // then an explicit choice in the To selects.
                  setToYear(year);
                  setToMonth(month);
                  setRangeMode(true);
                }
              }}
              aria-pressed={rangeMode}
            >
              {rangeMode ? 'Single month' : 'Custom range'}
            </button>
            <button type="button" className={historyStyles.button} onClick={handleExport} disabled={loading || !records.length}>
              Export .xlsx
            </button>
            <button type="button" className={historyStyles.button} onClick={() => setCategoriesOpen(true)}>
              Categories
            </button>
            {/* Same pair of entry points reimbursement offers: one expense
                goes to its own page, several are entered inline here. */}
            <button
              type="button"
              className={historyStyles.button}
              onClick={() => setBulkOpen((v) => !v)}
            >
              {bulkOpen ? 'Cancel' : '+ Add Multiple'}
            </button>
            <button
              type="button"
              className={`${historyStyles.button} ${historyStyles.primary}`}
              onClick={() => router.push('/office-operation-expenses/new')}
            >
              + Add Expense
            </button>
          </div>
        </div>

        {bulkOpen && (
          <OfficeOperationExpenseBulkForm
            onClose={() => setBulkOpen(false)}
            onSaved={() => fetchRecords(year, month, rangeToYear, rangeToMonth)}
          />
        )}

        {records.length > 0 && (
          <div
            className={styles.totalBanner}
            style={loading ? { opacity: 0.55 } : undefined}
          >
            <div className={styles.totalBannerText}>
              <strong>{periodLabel} total:</strong>{' '}
              <strong className={styles.totalAmount}>{formatCurrency(total)}</strong>
              <span className={styles.mutedText}> across {records.length} {records.length === 1 ? 'entry' : 'entries'}</span>
            </div>
            {totalInWords && <div className={styles.totalInWordsText}>{totalInWords}</div>}
          </div>
        )}

        {loading && !hasLoadedOnce ? (
          <div className={styles.loadingState}>Loading…</div>
        ) : records.length === 0 ? (
          <div className={styles.emptyState}>
            {loading ? 'Loading…' : <>No expenses recorded for {MONTH_NAMES[month]} {year}. Click &quot;+ Add Expense&quot; to add the first entry.</>}
          </div>
        ) : (
          <div className={historyStyles.tableWrap} style={loading ? { opacity: 0.55, pointerEvents: 'none' } : undefined} aria-busy={loading || undefined}>
            <table className={historyStyles.table}>
              <thead>
                <tr>
                  <th>Sr No.</th>
                  <th>Date</th>
                  <th>Office</th>
                  <th>Category</th>
                  <th>Expense Head</th>
                  <th style={{ textAlign: 'right' }}>Qty</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                  <th>Description</th>
                  <th>Paid By</th>
                  <th>Entered By</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.id}>
                    <td className={styles.srNoCell}>{formatSrNo(record.sr_no)}</td>
                    <td className={styles.nowrap}>{formatDate(record.date)}</td>
                    <td className={styles.nowrap}>{record.office_location || '—'}</td>
                    <td>
                      {/* Detail sits inline beside the usecase badge, matching
                          the Expense Head / sub-category pairing below. */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: '12px', fontWeight: 600, background: '#dbeafe', color: '#1e40af', whiteSpace: 'nowrap' }}>
                          {record.usecase}
                        </span>
                        {record.usecase_detail && (
                          <span style={{
                            display: 'inline-block', padding: '1px 8px', borderRadius: 10,
                            fontSize: '11.5px', background: '#f3f4f6', color: '#374151', fontWeight: 500,
                            whiteSpace: 'nowrap'
                          }}>
                            {record.usecase_detail}
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      {/* Sub-category sits inline beside the head rather than
                          stacked under it, so the pair reads as one value. */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span>{record.item_name}</span>
                        {record.item_sub_names.map((sub) => (
                          <span key={sub} style={{
                            display: 'inline-block', padding: '1px 8px', borderRadius: 10,
                            fontSize: '11.5px', background: '#f3f4f6', color: '#374151', fontWeight: 500,
                            whiteSpace: 'nowrap'
                          }}>
                            {sub}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{record.item_qty ?? '—'}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(record.amount)}</td>
                    <td style={{ maxWidth: 220 }}>{record.description || '—'}</td>
                    <td style={{ maxWidth: 200 }}>{record.remarks || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap', fontSize: '12.5px', color: 'var(--mx-ink-muted)' }}>{record.creator_name || '—'}</td>
                    <td>
                      <div className={styles.rowActions}>
                        <button
                          type="button"
                          onClick={() => router.push(`/office-operation-expenses/${record.id}/edit`)}
                          className={styles.editButton}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(record)}
                          disabled={deleting === record.id}
                          className={styles.deleteButton}
                          style={{ opacity: deleting === record.id ? 0.5 : 1 }}
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
