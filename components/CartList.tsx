'use client';

import { CartItem } from '@/lib/types';
import { formatMoney } from '@/lib/format';
import styles from './calculator.module.css';

interface CartListProps {
  items: CartItem[];
  onAdd: () => void;
  onRemove: (id: number) => void;
  onChangeRemark: (id: number, remark: string) => void;
  // Whether a product is actually configured above right now — used to make
  // the "add" button visually obvious as the next step (solid, primary)
  // instead of looking like just another dashed "+" button on the page.
  hasActiveProduct: boolean;
}

export default function CartList({ items, onAdd, onRemove, onChangeRemark, hasActiveProduct }: CartListProps) {
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
        <button
          type="button"
          className={hasActiveProduct ? styles.btn : styles.secondaryButton}
          onClick={onAdd}
          style={{ width: '100%' }}
        >
          {hasActiveProduct ? '✅ Add This Product to the Quote' : 'Add This Product to the Quote'}
        </button>
        <div className={styles.small}>
          {hasActiveProduct
            ? 'Ready to add. Tap the button above, then pick another product to add more.'
            : 'Fill in the product details above first — this button turns solid red once it’s ready to add.'}
        </div>
      </div>
    </div>
  );
}
