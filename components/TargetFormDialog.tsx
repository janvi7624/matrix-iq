'use client';

import { useEffect, useMemo, useState } from 'react';
import Modal, { ModalCancelButton, ModalOkButton } from './ui/Modal';
import { useToast } from './ui/ToastProvider';
import { fiscalYearOptions, TargetPeriodType } from '@/lib/targetPeriod';
import { fiscalYearMonthKeys, MonthAmounts, rollupSummary } from '@/lib/targetRollup';
import { formatMoney } from '@/lib/format';
import calcStyles from './calculator.module.css';
import historyStyles from './quotationHistory.module.css';
import styles from './targetDetails.module.css';

interface TargetFormDialogProps {
  employeeId: string;
  employeeName: string;
  // The fiscal year to open on — the parent's current filter. The year itself
  // stays switchable in here, since setting next year's targets is a normal
  // thing to do from the current year's view.
  defaultFiscalYear: string;
  onClose: () => void;
  /**
   * Reports WHERE the target was saved, not just that it was. The dialog's
   * period selector is independent of the page's, so without this the caller
   * cannot know which period to show and silently reloads the wrong one.
   */
  onSaved: (saved: { periodType: TargetPeriodType; fiscalYear: string; periodKey: string }) => void;
}

const MONTH_LABEL_FROM_KEY = (key: string) => {
  const [year, month] = key.split('-');
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(month) - 1]} ${year}`;
};

export default function TargetFormDialog({
  employeeId,
  employeeName,
  defaultFiscalYear,
  onClose,
  onSaved
}: TargetFormDialogProps) {
  const toast = useToast();

  const [fiscalYear, setFiscalYear] = useState(defaultFiscalYear);
  // Kept as strings, not numbers, so a cleared box stays cleared instead of
  // snapping to 0 while somebody is mid-edit.
  const [monthInputs, setMonthInputs] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // Which (employee, year) the grid below currently holds figures for.
  // `loading` is derived from it rather than being its own state, so the
  // prefill effect sets no state synchronously in its body — the year switch
  // shows the loader for free, because the key stops matching.
  const [loadedFor, setLoadedFor] = useState('');
  const loadKey = `${employeeId}|${fiscalYear}`;
  const loading = loadedFor !== loadKey;

  const monthKeys = useMemo(() => fiscalYearMonthKeys(fiscalYear), [fiscalYear]);

  // Prefill from whatever is already on file for this person and year, so
  // editing means adjusting three months rather than retyping twelve. Re-runs
  // on a year switch — the figures are per fiscal year.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/targets/months?employeeId=${encodeURIComponent(employeeId)}&fiscalYear=${encodeURIComponent(fiscalYear)}`);
        const body = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok) {
          setError(body.error || 'Could not load the existing targets.');
          setMonthInputs({});
          return;
        }
        const next: Record<string, string> = {};
        for (const [key, amount] of Object.entries((body.months ?? {}) as Record<string, number>)) {
          next[key] = amount > 0 ? String(amount) : '';
        }
        setError('');
        setMonthInputs(next);
      } catch {
        if (!cancelled) setError('Could not reach the server.');
      } finally {
        if (!cancelled) setLoadedFor(loadKey);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [employeeId, fiscalYear, loadKey]);

  const months: MonthAmounts = useMemo(() => {
    const out: MonthAmounts = {};
    for (const key of monthKeys) {
      const amount = Number(monthInputs[key]);
      out[key] = Number.isFinite(amount) && amount > 0 ? amount : 0;
    }
    return out;
  }, [monthKeys, monthInputs]);

  // The quarters, halves and year the entered months add up to — computed by
  // the same function the API writes with, so the preview can't disagree with
  // what gets saved.
  const rollup = useMemo(() => rollupSummary(fiscalYear, months), [fiscalYear, months]);
  const hasAnyTarget = rollup.annual > 0;

  function setMonth(key: string, value: string) {
    setMonthInputs((prev) => ({ ...prev, [key]: value }));
  }

  // Typing one figure and filling the rest of the year with it — the common
  // case when most months are the same and only a few differ. Overwrites every
  // month, so it's a starting point to then adjust, not an increment.
  function fillAllFrom(key: string) {
    const value = monthInputs[key] ?? '';
    setMonthInputs(Object.fromEntries(monthKeys.map((k) => [k, value])));
  }

  async function handleSave() {
    if (!hasAnyTarget) {
      setError('Set a target of more than zero for at least one month');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId, fiscalYear, months, notes })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error || 'Could not save these targets.');
        return;
      }
      toast.success(`Targets saved — FY ${fiscalYear} totals ${formatMoney(rollup.annual)}.`);
      // Land the page on a month that actually carries a figure, not on
      // whatever was being viewed before. The first funded month is certain to
      // exist: handleSave returns early unless rollup.annual > 0.
      const landOn = monthKeys.find((key) => months[key] > 0) ?? monthKeys[0];
      onSaved({ periodType: 'monthly', fiscalYear, periodKey: landOn });
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`Set Monthly Targets — ${employeeName}`}
      ariaLabel={`Set monthly targets for ${employeeName}`}
      onClose={onClose}
      size="wide"
      footer={
        <>
          <ModalCancelButton onClick={onClose}>Cancel</ModalCancelButton>
          <ModalOkButton onClick={handleSave} disabled={saving || loading}>{saving ? 'Saving…' : 'Save'}</ModalOkButton>
        </>
      }
    >
      {error && <div className={historyStyles.loginError}>{error}</div>}

      <div className={calcStyles.field}>
        <label>Fiscal Year</label>
        <select className={calcStyles.formControl} value={fiscalYear} onChange={(e) => setFiscalYear(e.target.value)}>
          {fiscalYearOptions().map((fy) => (
            <option key={fy} value={fy}>FY {fy}</option>
          ))}
        </select>
      </div>

      {/* Each month its own figure — the whole point of this form. Quarters,
          halves and the year are sums of these and are therefore shown as
          read-only totals below, never typed. */}
      <div className={calcStyles.field}>
        <label>Monthly Targets (₹)</label>
        {loading ? (
          <div className={calcStyles.small}>Loading existing targets…</div>
        ) : (
          <div className={styles.monthGrid}>
            {monthKeys.map((key) => (
              <div key={key} className={styles.monthCell}>
                <span className={styles.cascadeLabel}>{MONTH_LABEL_FROM_KEY(key)}</span>
                <input
                  type="number"
                  className={calcStyles.formControl}
                  min="0"
                  step="0.01"
                  placeholder="0"
                  value={monthInputs[key] ?? ''}
                  onChange={(e) => setMonth(key, e.target.value)}
                  aria-label={`Target for ${MONTH_LABEL_FROM_KEY(key)}`}
                />
                <button
                  type="button"
                  className={styles.monthFillBtn}
                  onClick={() => fillAllFrom(key)}
                  disabled={!monthInputs[key]}
                  title="Copy this figure to every month of the year"
                >
                  Apply to all
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={calcStyles.sectionPanel}>
        <div className={calcStyles.small}>
          Quarters, halves and the year are the <strong>totals of the months above</strong> — they update as you type and
          are not entered separately. Saving replaces {employeeName}&apos;s targets for every period of FY {fiscalYear}.
        </div>

        <div className={styles.cascadeGrid}>
          {rollup.quarters.map((q) => (
            <div key={q.key} className={styles.cascadeCell}>
              <span className={styles.cascadeLabel}>{q.key}</span>
              <span className={styles.cascadeValue}>{formatMoney(q.amount)}</span>
            </div>
          ))}
          {rollup.halves.map((h) => (
            <div key={h.key} className={styles.cascadeCell}>
              <span className={styles.cascadeLabel}>{h.key}</span>
              <span className={styles.cascadeValue}>{formatMoney(h.amount)}</span>
            </div>
          ))}
          <div className={`${styles.cascadeCell} ${styles.cascadeCellEntered}`}>
            <span className={styles.cascadeLabel}>FY {fiscalYear}</span>
            <span className={styles.cascadeValue}>{formatMoney(rollup.annual)}</span>
          </div>
        </div>
      </div>

      <div className={calcStyles.field}>
        <label>Notes</label>
        <textarea className={calcStyles.formControl} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional commentary for this fiscal year" />
      </div>
    </Modal>
  );
}
