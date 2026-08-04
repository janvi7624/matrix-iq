'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { formatMoney } from '@/lib/format';
import { selectAllOnFocus } from '@/lib/numberInputHelpers';
import { DomainResult, LineItem, SiItem } from '@/lib/types';
import styles from '../calculator.module.css';

interface SiEstimatorProps {
  active: boolean;
  onResultChange: (result: DomainResult) => void;
}

export default function SiEstimator({ active, onResultChange }: SiEstimatorProps) {
  const [items, setItems] = useState<SiItem[]>([]);
  const nextId = useRef(1);

  const result = useMemo<DomainResult>(() => {
    let subtotal = 0;
    const lineItems: LineItem[] = items.map((item) => {
      const qty = Math.max(1, Math.round(item.qty) || 1);
      const price = Number(item.price) || 0;
      const amount = qty * price;
      subtotal += amount;
      return { description: item.name && item.name.trim() ? item.name.trim() : 'SI item', qty, rate: price, amount, unit: 'Nos' };
    });
    const summary = [
      { label: 'SI items', value: String(items.length) },
      { label: 'SI subtotal', value: formatMoney(subtotal) }
    ];

    return { label: `System Integration — ${items.length} item(s)`, domainKey: 'si', lineItems, subtotal, summary };
  }, [items]);

  useEffect(() => {
    if (active) onResultChange(result);
  }, [active, result, onResultChange]);

  const updateItem = (id: number, patch: Partial<SiItem>) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  return (
    <section className={`${styles.sectionPanel} ${active ? '' : styles.hidden}`}>
      <h2 className={styles.h2}>System Integration Estimator</h2>
      <p className={styles.small}>No fixed catalog yet for this domain — add each item (equipment, labor, licenses, etc.) as a line below. Ask NANTA to add a proper product catalog for System Integration when pricing data is available.</p>
      <div className={styles.field}>
        <label className={styles.label}>SI line items</label>
        <div>
          {items.map((item) => (
            <div key={item.id} className={styles.lineItemRow}>
              <input
                type="text"
                className={`${styles.formControl} ${styles.lineItemInput}`}
                placeholder="Item / scope description"
                value={item.name}
                onChange={(e) => updateItem(item.id, { name: e.target.value })}
              />
              <input
                type="number"
                className={`${styles.formControl} ${styles.lineItemInput}`}
                min={1}
                step={1}
                placeholder="Qty"
                value={item.qty}
                onFocus={selectAllOnFocus}
                onChange={(e) => updateItem(item.id, { qty: Math.max(1, parseInt(e.target.value, 10) || 1) })}
              />
              <input
                type="number"
                className={`${styles.formControl} ${styles.lineItemInput}`}
                min={0}
                step="any"
                placeholder="Unit price (₹)"
                value={item.price}
                onFocus={selectAllOnFocus}
                onChange={(e) => updateItem(item.id, { price: parseFloat(e.target.value) || 0 })}
              />
              <button type="button" className={styles.removeItemBtn} title="Remove item" onClick={() => setItems((prev) => prev.filter((i) => i.id !== item.id))}>
                ×
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={() => {
            setItems((prev) => [...prev, { id: nextId.current++, name: '', qty: 1, price: 0 }]);
          }}
        >
          + Add SI Item
        </button>
      </div>
    </section>
  );
}
