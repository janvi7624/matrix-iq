'use client';

import { Discount } from '@/lib/types';
import { selectAllOnFocus } from '@/lib/numberInputHelpers';
import styles from './calculator.module.css';

interface DiscountsListProps {
  discounts: Discount[];
  onAdd: () => void;
  onChangeItem: (id: number, patch: Partial<Discount>) => void;
  onRemove: (id: number) => void;
  // Discounts change the final price — locked to Manager/Admin/Super Admin,
  // same as Markup % and Custom Product price.
  canEdit: boolean;
}

export default function DiscountsList({ discounts, onAdd, onChangeItem, onRemove, canEdit }: DiscountsListProps) {
  return (
    <div className={styles.row}>
      <div className={styles.field}>
        <label className={styles.label}>Discounts</label>
        <div>
          {discounts.map((discount) => (
            <div key={discount.id} className={styles.lineItemRow}>
              <input
                type="text"
                className={canEdit ? `${styles.formControl} ${styles.lineItemInput}` : `${styles.formControl} ${styles.lineItemInput} ${styles.formControlLocked}`}
                placeholder="Discount label"
                value={discount.label}
                readOnly={!canEdit}
                tabIndex={canEdit ? undefined : -1}
                onChange={canEdit ? (e) => onChangeItem(discount.id, { label: e.target.value }) : undefined}
              />
              <select
                className={canEdit ? `${styles.formControl} ${styles.lineItemInput}` : `${styles.formControl} ${styles.lineItemInput} ${styles.formControlLocked}`}
                value={discount.type}
                disabled={!canEdit}
                onChange={(e) => onChangeItem(discount.id, { type: e.target.value as 'percent' | 'flat' })}
              >
                <option value="percent">% of total</option>
                <option value="flat">Flat amount (₹)</option>
              </select>
              <input
                type="number"
                className={canEdit ? `${styles.formControl} ${styles.lineItemInput}` : `${styles.formControl} ${styles.lineItemInput} ${styles.formControlLocked}`}
                min={0}
                step="any"
                placeholder="Value"
                value={discount.value === 0 ? '' : discount.value}
                readOnly={!canEdit}
                tabIndex={canEdit ? undefined : -1}
                onFocus={canEdit ? selectAllOnFocus : undefined}
                onChange={canEdit ? (e) => onChangeItem(discount.id, { value: parseFloat(e.target.value) || 0 }) : undefined}
              />
              {canEdit && (
                <button type="button" className={styles.removeItemBtn} title="Remove discount" onClick={() => onRemove(discount.id)}>
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
        {canEdit ? (
          <button type="button" className={styles.secondaryButton} onClick={onAdd}>
            + Add Discount
          </button>
        ) : (
          <span className={styles.lockedHint}>Only a manager can add or change discounts.</span>
        )}
      </div>
    </div>
  );
}
