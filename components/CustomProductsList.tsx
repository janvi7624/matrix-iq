'use client';

import { CustomProduct } from '@/lib/types';
import styles from './calculator.module.css';

interface CustomProductsListProps {
  products: CustomProduct[];
  onAdd: () => void;
  onChangeItem: (id: number, patch: Partial<CustomProduct>) => void;
  onRemove: (id: number) => void;
}

export default function CustomProductsList({ products, onAdd, onChangeItem, onRemove }: CustomProductsListProps) {
  return (
    <div className={styles.row}>
      <div className={styles.field}>
        <label className={styles.label}>Custom products</label>
        <div className={styles.small}>Use this to build tailor-made / preplanned AV projects (e.g. auditorium or theatre seating layouts) line by line, or to add any item not in the standard catalogs.</div>
        <div>
          {products.map((item) => (
            <div key={item.id} className={styles.lineItemRow}>
              <input
                type="text"
                className={`${styles.formControl} ${styles.lineItemInput}`}
                placeholder="Product name"
                value={item.name}
                onChange={(e) => onChangeItem(item.id, { name: e.target.value })}
              />
              <input
                type="number"
                className={`${styles.formControl} ${styles.lineItemInput}`}
                min={1}
                step={1}
                placeholder="Qty"
                value={item.qty}
                onChange={(e) => onChangeItem(item.id, { qty: Math.max(1, parseInt(e.target.value, 10) || 1) })}
              />
              <input
                type="number"
                className={`${styles.formControl} ${styles.lineItemInput}`}
                min={0}
                step="any"
                placeholder="Unit price (₹)"
                value={item.price}
                onChange={(e) => onChangeItem(item.id, { price: parseFloat(e.target.value) || 0 })}
              />
              <button type="button" className={styles.removeItemBtn} title="Remove product" onClick={() => onRemove(item.id)}>
                ×
              </button>
            </div>
          ))}
        </div>
        <button type="button" className={styles.secondaryButton} onClick={onAdd}>
          + Add Custom Product
        </button>
      </div>
    </div>
  );
}
