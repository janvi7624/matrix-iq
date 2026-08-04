'use client';

import { useEffect, useState } from 'react';
import { CustomProduct, ProductRecord } from '@/lib/types';
import { selectAllOnFocus } from '@/lib/numberInputHelpers';
import styles from './calculator.module.css';

interface CustomProductsListProps {
  products: CustomProduct[];
  onAdd: () => void;
  onAddFromCatalog?: (product: ProductRecord) => void;
  onChangeItem: (id: number, patch: Partial<CustomProduct>) => void;
  onRemove: (id: number) => void;
  // Free-typed prices are locked to Manager/Admin/Super Admin — picking from
  // the Product Master catalog (which fills in the correct price) still
  // works for everyone.
  canEditPrice: boolean;
}

export default function CustomProductsList({ products, onAdd, onAddFromCatalog, onChangeItem, onRemove, canEditPrice }: CustomProductsListProps) {
  const [catalog, setCatalog] = useState<ProductRecord[]>([]);
  const [pickedId, setPickedId] = useState('');

  useEffect(() => {
    fetch('/api/products')
      .then((r) => (r.ok ? r.json() : []))
      .then((data: ProductRecord[]) => setCatalog(data))
      .catch(() => setCatalog([]));
  }, []);

  return (
    <div className={styles.row}>
      <div className={styles.field}>
        <label className={styles.label}>Custom products</label>
        <div className={styles.small}>Use this to build tailor-made / preplanned AV projects (e.g. auditorium or theatre seating layouts) line by line, or to add any item not in the standard catalogs.</div>
        {catalog.length > 0 && onAddFromCatalog && (
          <div className={styles.lineItemRow} style={{ alignItems: 'center' }}>
            <select
              className={`${styles.formControl} ${styles.lineItemInput}`}
              style={{ flex: 2 }}
              value={pickedId}
              onChange={(e) => {
                const product = catalog.find((p) => p.id === e.target.value);
                if (product) {
                  onAddFromCatalog(product);
                  setPickedId('');
                }
              }}
            >
              <option value="">Pick from Product Master catalog...</option>
              {catalog.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.sku ? ` (${p.sku})` : ''} — {p.sellingPrice}
                </option>
              ))}
            </select>
          </div>
        )}
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
                onFocus={selectAllOnFocus}
                onChange={(e) => onChangeItem(item.id, { qty: Math.max(1, parseInt(e.target.value, 10) || 1) })}
              />
              <input
                type="number"
                className={canEditPrice ? `${styles.formControl} ${styles.lineItemInput}` : `${styles.formControl} ${styles.lineItemInput} ${styles.formControlLocked}`}
                min={0}
                step="any"
                placeholder={canEditPrice ? 'Enter Product Price' : 'Ask a manager to set the price'}
                title={canEditPrice ? undefined : 'Only a manager can type a custom price. Pick from the catalog above instead, or ask a manager to fill this in.'}
                value={item.price === 0 ? '' : item.price}
                readOnly={!canEditPrice}
                tabIndex={canEditPrice ? undefined : -1}
                onFocus={canEditPrice ? selectAllOnFocus : undefined}
                onChange={canEditPrice ? (e) => onChangeItem(item.id, { price: parseFloat(e.target.value) || 0 }) : undefined}
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
