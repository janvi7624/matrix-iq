'use client';

import { useState } from 'react';
import Modal, { ModalCancelButton, ModalOkButton } from './ui/Modal';
import { useToast } from './ui/ToastProvider';
import { fiscalYearOptions, TargetPeriodType } from '@/lib/targetPeriod';
import { cascadeSummary, CASCADE_PERIOD_TYPES } from '@/lib/targetCascade';
import { formatMoney } from '@/lib/format';
import calcStyles from './calculator.module.css';
import historyStyles from './quotationHistory.module.css';
import styles from './targetDetails.module.css';

const PERIOD_TYPE_LABEL: Record<TargetPeriodType, string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  half_yearly: 'Half-Yearly',
  annual: 'Annual'
};

interface TargetFormDialogProps {
  employeeId: string;
  employeeName: string;
  // When set, editing this existing target (amount/notes only — period and
  // employee are immutable once a target is created). When absent, creating
  // a new one for this employee, defaulting to the parent's current filter.
  existingTarget?: { id: string; periodType: TargetPeriodType; displayPeriod: string; targetAmount: number; notes: string } | null;
  defaultPeriodType: TargetPeriodType;
  defaultFiscalYear: string;
  onClose: () => void;
  onSaved: () => void;
}

export default function TargetFormDialog({
  employeeId,
  employeeName,
  existingTarget,
  defaultPeriodType,
  defaultFiscalYear,
  onClose,
  onSaved
}: TargetFormDialogProps) {
  const toast = useToast();
  const isEdit = !!existingTarget;

  const [periodType, setPeriodType] = useState<TargetPeriodType>(existingTarget?.periodType ?? defaultPeriodType);
  const [fiscalYear, setFiscalYear] = useState(defaultFiscalYear);
  const [targetAmount, setTargetAmount] = useState(existingTarget ? String(existingTarget.targetAmount) : '');
  const [notes, setNotes] = useState(existingTarget?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // What this one figure works out to at each scale — previewed live, so
  // nobody has to save first to find out what the year just became.
  const amount = Number(targetAmount);
  const preview = Number.isFinite(amount) && amount > 0 ? cascadeSummary(periodType, amount) : null;

  async function handleSave() {
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Target amount must be greater than zero');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = isEdit
        ? await fetch(`/api/targets/${existingTarget!.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetAmount: amount, notes })
          })
        : await fetch('/api/targets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              employeeId,
              periodType,
              fiscalYear,
              targetAmount: amount,
              notes
            })
          });

      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error || 'Could not save this target.');
        return;
      }
      // Say how far it reached: the one figure just re-priced every period
      // of the fiscal year, and a toast that only said "saved" would hide
      // the 18 other rows that changed.
      const periods = body?.cascade?.periods;
      toast.success(
        periods
          ? `${isEdit ? 'Target updated' : 'Target set'} — all ${periods} periods of FY ${fiscalYear} re-priced.`
          : isEdit ? 'Target updated.' : 'Target created.'
      );
      onSaved();
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={isEdit ? `Edit Target — ${employeeName}` : `Set Target — ${employeeName}`}
      ariaLabel={isEdit ? `Edit target for ${employeeName}` : `Set target for ${employeeName}`}
      onClose={onClose}
      size="wide"
      footer={
        <>
          <ModalCancelButton onClick={onClose}>Cancel</ModalCancelButton>
          <ModalOkButton onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</ModalOkButton>
        </>
      }
    >
      {error && <div className={historyStyles.loginError}>{error}</div>}

      {isEdit ? (
        <div className={calcStyles.field}>
          <label>Period</label>
          <div>{existingTarget!.displayPeriod}</div>
        </div>
      ) : (
        <>
          <div className={calcStyles.field}>
            <label>Target Period</label>
            <select className={calcStyles.formControl} value={periodType} onChange={(e) => setPeriodType(e.target.value as TargetPeriodType)}>
              {(Object.keys(PERIOD_TYPE_LABEL) as TargetPeriodType[]).map((pt) => (
                <option key={pt} value={pt}>{PERIOD_TYPE_LABEL[pt]}</option>
              ))}
            </select>
          </div>
          <div className={calcStyles.field}>
            <label>Fiscal Year</label>
            <select className={calcStyles.formControl} value={fiscalYear} onChange={(e) => setFiscalYear(e.target.value)}>
              {fiscalYearOptions().map((fy) => (
                <option key={fy} value={fy}>FY {fy}</option>
              ))}
            </select>
          </div>
        </>
      )}

      <div className={calcStyles.field}>
        <label>{PERIOD_TYPE_LABEL[periodType]} Target Amount (₹) *</label>
        <input type="number" className={calcStyles.formControl} min="0" step="0.01" value={targetAmount} onChange={(e) => setTargetAmount(e.target.value)} />
      </div>

      {/* The four period types are one number at four scales, so setting any
          one of them sets the rest — shown here rather than discovered after
          saving. */}
      <div className={calcStyles.sectionPanel}>
        <div className={calcStyles.small}>
          This sets every period of FY {fiscalYear} — all 12 months, 4 quarters, both halves and the year.
          Any target already set for {employeeName} in this fiscal year is replaced.
        </div>
        <div className={styles.cascadeGrid}>
          {CASCADE_PERIOD_TYPES.map((pt) => (
            <div key={pt} className={`${styles.cascadeCell} ${pt === periodType ? styles.cascadeCellEntered : ''}`}>
              <span className={styles.cascadeLabel}>{PERIOD_TYPE_LABEL[pt]}</span>
              <span className={styles.cascadeValue}>{preview ? formatMoney(preview[pt]) : '—'}</span>
            </div>
          ))}
        </div>
      </div>

      <div className={calcStyles.field}>
        <label>Notes</label>
        <textarea className={calcStyles.formControl} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional commentary for this period" />
      </div>
    </Modal>
  );
}
