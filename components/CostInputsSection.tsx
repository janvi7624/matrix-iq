'use client';

import { CostInputs } from '@/lib/types';
import { selectAllOnFocus } from '@/lib/numberInputHelpers';
import styles from './calculator.module.css';

interface CostInputsSectionProps {
  costInputs: CostInputs;
  onChange: (patch: Partial<CostInputs>) => void;
  showScaffolding: boolean;
  showInstallFabrication: boolean;
  // Markup % sets profit margin — locked to Manager/Admin/Super Admin, same
  // as Discounts and Custom Product price. Everyone else sees it read-only.
  canEditMarkup: boolean;
}

export default function CostInputsSection({ costInputs, onChange, showScaffolding, showInstallFabrication, canEditMarkup }: CostInputsSectionProps) {
  return (
    <>
      {showInstallFabrication && (
        <div>
          <div className={`${styles.row} ${styles.columns}`}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="installationCost">Additional installation cost</label>
              <input
                id="installationCost"
                className={styles.formControl}
                type="number"
                step="any"
                min={0}
                placeholder="0"
                value={costInputs.installationCost === 0 ? '' : costInputs.installationCost}
                onFocus={selectAllOnFocus}
                onChange={(e) => onChange({ installationCost: parseFloat(e.target.value) || 0 })}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="fabricationCost">Fabrication cost</label>
              <input
                id="fabricationCost"
                className={styles.formControl}
                type="number"
                step="any"
                min={0}
                placeholder="0"
                value={costInputs.fabricationCost === 0 ? '' : costInputs.fabricationCost}
                onFocus={selectAllOnFocus}
                onChange={(e) => onChange({ fabricationCost: parseFloat(e.target.value) || 0 })}
              />
            </div>
          </div>
          {showScaffolding && (
            <div className={`${styles.row} ${styles.columns}`}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="scaffoldingCost">Scaffolding cost</label>
                <input
                  id="scaffoldingCost"
                  className={styles.formControl}
                  type="number"
                  step="any"
                  min={0}
                  placeholder="0"
                  value={costInputs.scaffoldingCost === 0 ? '' : costInputs.scaffoldingCost}
                  onFocus={selectAllOnFocus}
                  onChange={(e) => onChange({ scaffoldingCost: parseFloat(e.target.value) || 0 })}
                />
              </div>
            </div>
          )}
        </div>
      )}
      <div className={`${styles.row} ${styles.columns}`}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="markupPercent">Markup %</label>
          <input
            id="markupPercent"
            className={canEditMarkup ? styles.formControl : `${styles.formControl} ${styles.formControlLocked}`}
            type="number"
            step="any"
            min={0}
            placeholder="0"
            value={costInputs.markupPercent === 0 ? '' : costInputs.markupPercent}
            readOnly={!canEditMarkup}
            tabIndex={canEditMarkup ? undefined : -1}
            onFocus={canEditMarkup ? selectAllOnFocus : undefined}
            onChange={canEditMarkup ? (e) => onChange({ markupPercent: parseFloat(e.target.value) || 0 }) : undefined}
          />
          <span className={styles.lockedHint}>
            {canEditMarkup
              ? 'Extra profit margin added on top of cost — leave at 0 if not applicable.'
              : 'Only a manager can set the profit margin — ask a manager to adjust this before sending.'}
          </span>
        </div>
      </div>
    </>
  );
}
