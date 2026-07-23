'use client';

import { Discount } from '@/lib/types';
import styles from './calculator.module.css';

interface DiscountsListProps {
  discounts: Discount[];
  onAdd: () => void;
  onChangeItem: (id: number, patch: Partial<Discount>) => void;
  onRemove: (id: number) => void;
}

export default function DiscountsList({ discounts, onAdd, onChangeItem, onRemove }: DiscountsListProps) {
  return (
    <div className={styles.row}>
      <div className={styles.field}>
        <label className={styles.label}>Discounts</label>
        <div>
          {discounts.map((discount) => (
            <div key={discount.id} className={styles.lineItemRow}>
              <input
                type="text"
                className={`${styles.formControl} ${styles.lineItemInput}`}
                placeholder="Discount label"
                value={discount.label}
                onChange={(e) => onChangeItem(discount.id, { label: e.target.value })}
              />
              <select
                className={`${styles.formControl} ${styles.lineItemInput}`}
                value={discount.type}
                onChange={(e) => onChangeItem(discount.id, { type: e.target.value as 'percent' | 'flat' })}
              >
                <option value="percent">% of total</option>
                <option value="flat">Flat amount (₹)</option>
              </select>
              <input
                type="number"
                className={`${styles.formControl} ${styles.lineItemInput}`}
                min={0}
                step="any"
                placeholder="Value"
                value={discount.value}
                onChange={(e) => onChangeItem(discount.id, { value: parseFloat(e.target.value) || 0 })}
              />
              <button type="button" className={styles.removeItemBtn} title="Remove discount" onClick={() => onRemove(discount.id)}>
                ×
              </button>
            </div>
          ))}
        </div>
        <button type="button" className={styles.secondaryButton} onClick={onAdd}>
          + Add Discount
        </button>
      </div>
    </div>
  );
}
