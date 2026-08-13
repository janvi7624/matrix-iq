'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { roboticsProducts } from '@/lib/data/roboticsProducts';
import { formatMoney } from '@/lib/format';
import { selectAllOnFocus } from '@/lib/numberInputHelpers';
import { DomainResult, LineItem } from '@/lib/types';
import { applyOverride, overrideMapKey, OverrideMap } from '@/lib/catalogOverrides';
import styles from '../calculator.module.css';

interface RoboticsEstimatorProps {
  active: boolean;
  onResultChange: (result: DomainResult) => void;
  overrides: OverrideMap;
}

type Tier = 'distributor' | 'partner' | 'customer';

export default function RoboticsEstimator({ active, onResultChange, overrides }: RoboticsEstimatorProps) {
  const modelKeys = Object.keys(roboticsProducts);
  const [modelKey, setModelKey] = useState(modelKeys[0]);
  const [priceTier, setPriceTier] = useState<Tier>('distributor');
  const [quantity, setQuantity] = useState(1);

  const product = useMemo(() => {
    const base = roboticsProducts[modelKey];
    if (!base) return undefined;
    return applyOverride(base, overrides.get(overrideMapKey('robotics', modelKey)), 'description');
  }, [modelKey, overrides]);

  const result = useMemo<DomainResult | null>(() => {
    if (!product) return null;
    const qty = Math.max(1, Math.round(quantity) || 1);
    const unitPrice = priceTier === 'distributor' ? product.distributorPrice : priceTier === 'partner' ? product.partnerPrice : product.customerPrice;
    const baseCost = qty * unitPrice;

    const lineItems: LineItem[] = [{ description: `${modelKey} — ${product.category}`, qty, rate: unitPrice, amount: baseCost, unit: 'Nos' }];

    const tierLabel = priceTier === 'distributor' ? 'Distributor price' : priceTier === 'partner' ? 'Partner price' : 'Customer price';
    const summary = [
      { label: 'Robot model', value: `${modelKey} — ${product.category}` },
      { label: 'Price tier', value: tierLabel },
      { label: 'Quantity', value: String(qty) },
      { label: 'Unit price', value: formatMoney(unitPrice) },
      { label: 'Base cost', value: formatMoney(baseCost) }
    ];

    return { label: `Robotics — ${modelKey}`, domainKey: 'robotics', lineItems, subtotal: baseCost, summary };
  }, [product, modelKey, priceTier, quantity]);

  useEffect(() => {
    if (active && result) onResultChange(result);
  }, [active, result, onResultChange]);

  if (!product) return null;

  return (
    <section className={`${styles.sectionPanel} ${active ? '' : styles.hidden}`}>
      <h2 className={styles.h2}>Robotics Estimator</h2>
      <div className={`${styles.row} ${styles.columns}`}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="roboticsModel">Robot model</label>
          <select id="roboticsModel" className={styles.formControl} value={modelKey} onChange={(e) => setModelKey(e.target.value)}>
            {modelKeys.map((key) => (
              <option key={key} value={key}>{key} — {roboticsProducts[key].category}</option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="roboticsPriceTier">Price tier</label>
          <select id="roboticsPriceTier" className={styles.formControl} value={priceTier} onChange={(e) => setPriceTier(e.target.value as Tier)}>
            <option value="distributor">Distributor price</option>
            <option value="partner">Partner price</option>
            <option value="customer">Customer price</option>
          </select>
        </div>
      </div>
      <div className={`${styles.row} ${styles.columns}`}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="roboticsQuantity">Quantity</label>
          <input id="roboticsQuantity" className={styles.formControl} type="number" step={1} min={1} value={quantity} onFocus={selectAllOnFocus} onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))} />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="roboticsDetails">Model details</label>
          <textarea id="roboticsDetails" className={styles.formControl} rows={3} readOnly value={`${product.description}\nCategory: ${product.category}`} />
        </div>
      </div>
      {product.image && (
        <div className={`${styles.row} ${styles.columns}`}>
          <div className={`${styles.field} ${styles.standeePreview}`}>
            <label className={styles.label}>Preview</label>
            <div className={styles.imageHolder}>
              <Image src={product.image} alt={`${modelKey} preview`} width={220} height={220} className={styles.previewImg} unoptimized />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
