'use client';

import { CostInputs } from '@/lib/types';
import styles from './calculator.module.css';

interface CostInputsSectionProps {
  costInputs: CostInputs;
  onChange: (patch: Partial<CostInputs>) => void;
  showScaffolding: boolean;
  showInstallFabrication: boolean;
}

export default function CostInputsSection({ costInputs, onChange, showScaffolding, showInstallFabrication }: CostInputsSectionProps) {
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
                value={costInputs.installationCost}
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
                value={costInputs.fabricationCost}
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
                  value={costInputs.scaffoldingCost}
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
            className={styles.formControl}
            type="number"
            step="any"
            min={0}
            value={costInputs.markupPercent}
            onChange={(e) => onChange({ markupPercent: parseFloat(e.target.value) || 0 })}
          />
        </div>
      </div>
    </>
  );
}
