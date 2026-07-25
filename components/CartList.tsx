'use client';

import { CartItem } from '@/lib/types';
import { formatMoney } from '@/lib/format';
import styles from './calculator.module.css';

interface CartListProps {
  items: CartItem[];
  onAdd: () => void;
  onRemove: (id: number) => void;
  onChangeRemark: (id: number, remark: string) => void;
}

export default function CartList({ items, onAdd, onRemove, onChangeRemark }: CartListProps) {
  return (
    <div className={styles.row}>
      <div className={styles.field}>
        <label className={styles.label}>Products in this quote</label>
        <div>
          {items.map((item) => (
            <div key={item.id} style={{ marginBottom: 8 }}>
              <div className={styles.lineItemRow}>
                <span style={{ flex: 1 }}>{item.label}</span>
                <span>{formatMoney(item.subtotal)}</span>
                <button type="button" className={styles.removeItemBtn} title="Remove product" onClick={() => onRemove(item.id)}>
                  ×
                </button>
              </div>
              <input
                type="text"
                className={styles.formControl}
                placeholder="Remark for this product (optional) — shown in the PDF"
                value={item.remark || ''}
                onChange={(e) => onChangeRemark(item.id, e.target.value)}
              />
            </div>
          ))}
        </div>
        <button type="button" className={styles.secondaryButton} onClick={onAdd}>
          + Add configured product to quote
        </button>
        <div className={styles.small}>Configure a product above (any domain), then click this to add it here. Change the domain/model and click again to add another product to the same quote.</div>
      </div>
    </div>
  );
}
