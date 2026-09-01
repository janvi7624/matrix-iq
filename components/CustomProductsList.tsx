'use client';

import { useEffect, useState } from 'react';
import { CustomProduct, ProductRecord } from '@/lib/types';
import { selectAllOnFocus } from '@/lib/numberInputHelpers';
import styles from './calculator.module.css';
import listStyles from './customProductsList.module.css';

interface CustomProductsListProps {
  products: CustomProduct[];
  onAdd: () => void;
  onAddFromCatalog?: (product: ProductRecord) => void;
  onChangeItem: (id: number, patch: Partial<CustomProduct>) => void;
  onRemove: (id: number) => void;
}

// Unlike standard product pricing/markup/discount/margin (locked to
// Manager/Admin/Super Admin — see QuotationCalculator's canEditPricing), the
// price of a newly created Custom Product line item is always editable by
// whoever is building the quote: there's no catalog price to fall back to,
// so a Sales user who can't type a number here can't use Custom Product at
// all.
export default function CustomProductsList({ products, onAdd, onAddFromCatalog, onChangeItem, onRemove }: CustomProductsListProps) {
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
          <div className={`${styles.lineItemRow} ${listStyles.alignCenter}`}>
            <select
              className={`${styles.formControl} ${styles.lineItemInput} ${listStyles.flex2}`}
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
            <div key={item.id} className={`${styles.sectionPanel} ${listStyles.productCard}`}>
              <div className={styles.lineItemRow}>
                <input
                  type="text"
                  className={`${styles.formControl} ${styles.lineItemInput} ${listStyles.flex2}`}
                  placeholder="Product / Service name"
                  value={item.name}
                  onChange={(e) => onChangeItem(item.id, { name: e.target.value })}
                />
                <input
                  type="text"
                  className={`${styles.formControl} ${styles.lineItemInput}`}
                  placeholder="Unit (e.g. Nos.)"
                  value={item.unit}
                  onChange={(e) => onChangeItem(item.id, { unit: e.target.value })}
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
                  className={`${styles.formControl} ${styles.lineItemInput}`}
                  min={0}
                  step="any"
                  placeholder="Price"
                  value={item.price === 0 ? '' : item.price}
                  onFocus={selectAllOnFocus}
                  onChange={(e) => onChangeItem(item.id, { price: parseFloat(e.target.value) || 0 })}
                />
                <button type="button" className={styles.removeItemBtn} title="Remove product" onClick={() => onRemove(item.id)}>
                  ×
                </button>
              </div>
              <div className={`${styles.lineItemRow} ${styles.mt6}`}>
                <input
                  type="text"
                  className={`${styles.formControl} ${styles.lineItemInput}`}
                  placeholder="Description / Specification (optional)"
                  value={item.description}
                  onChange={(e) => onChangeItem(item.id, { description: e.target.value })}
                />
                <input
                  type="text"
                  className={`${styles.formControl} ${styles.lineItemInput}`}
                  placeholder="Remarks (optional)"
                  value={item.remarks}
                  onChange={(e) => onChangeItem(item.id, { remarks: e.target.value })}
                />
              </div>
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
