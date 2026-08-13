'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { interactivePanelProducts, InteractivePanelProduct } from '@/lib/data/interactivePanelProducts';
import { formatMoney } from '@/lib/format';
import { selectAllOnFocus } from '@/lib/numberInputHelpers';
import { CostInputs, DomainResult, LineItem } from '@/lib/types';
import { ModelPreset } from './ConferenceEstimator';
import { applyOverride, extraProductKeys, overrideMapKey, OverrideMap } from '@/lib/catalogOverrides';
import styles from '../calculator.module.css';

interface InteractivePanelEstimatorProps {
  active: boolean;
  costInputs: CostInputs;
  onResultChange: (result: DomainResult) => void;
  presetModel?: ModelPreset | null;
  overrides: OverrideMap;
}

type Tier = 'distributor' | 'partner' | 'customer';

export default function InteractivePanelEstimator({ active, costInputs, onResultChange, presetModel, overrides }: InteractivePanelEstimatorProps) {
  const baseModelKeys = Object.keys(interactivePanelProducts);
  const [modelKey, setModelKey] = useState(baseModelKeys[0]);
  const [priceTier, setPriceTier] = useState<Tier>('distributor');
  const [quantity, setQuantity] = useState(1);

  // Admin-added products (Product Catalog) have no entry in the hardcoded
  // interactivePanelProducts file — union their keys in and merge overrides
  // on top of whatever base exists (or {} for a brand-new product).
  const modelKeys = useMemo(() => [...baseModelKeys, ...extraProductKeys('interactive-panel', baseModelKeys, overrides)], [overrides]);
  const effectiveProducts = useMemo(() => {
    const map: Record<string, InteractivePanelProduct> = {};
    modelKeys.forEach((key) => {
      map[key] = applyOverride(interactivePanelProducts[key] || ({} as InteractivePanelProduct), overrides.get(overrideMapKey('interactive-panel', key)), 'name');
    });
    return map;
  }, [modelKeys, overrides]);

  useEffect(() => {
    if (presetModel && interactivePanelProducts[presetModel.modelKey]) setModelKey(presetModel.modelKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetModel?.nonce]);

  const product = effectiveProducts[modelKey];

  const result = useMemo<DomainResult | null>(() => {
    if (!product) return null;
    const qty = Math.max(1, Math.round(quantity) || 1);
    const unitPrice = priceTier === 'distributor' ? product.distributorPrice : priceTier === 'partner' ? product.partnerPrice : product.customerPrice;
    const baseCost = qty * unitPrice;
    const subtotal = baseCost + costInputs.installationCost + costInputs.fabricationCost;

    const lineItems: LineItem[] = [{ description: `${modelKey} — ${product.name}`, qty, rate: unitPrice, amount: baseCost, unit: 'Nos' }];
    if (costInputs.installationCost) lineItems.push({ description: 'Additional installation cost', qty: 1, rate: costInputs.installationCost, amount: costInputs.installationCost, unit: 'Nos' });
    if (costInputs.fabricationCost) lineItems.push({ description: 'Additional fabrication cost', qty: 1, rate: costInputs.fabricationCost, amount: costInputs.fabricationCost, unit: 'Nos' });

    const tierLabel = priceTier === 'distributor' ? 'Distributor price' : priceTier === 'partner' ? 'Partner price' : 'Customer price';
    const summary = [
      { label: 'Panel model', value: `${modelKey} — ${product.name}` },
      { label: 'Price tier', value: tierLabel },
      { label: 'Quantity', value: String(qty) },
      { label: 'Unit price', value: formatMoney(unitPrice) },
      { label: 'Base cost', value: formatMoney(baseCost) },
      ...(costInputs.installationCost ? [{ label: 'Installation cost', value: formatMoney(costInputs.installationCost) }] : []),
      ...(costInputs.fabricationCost ? [{ label: 'Fabrication cost', value: formatMoney(costInputs.fabricationCost) }] : [])
    ];

    return { label: `Interactive Flat Panel — ${modelKey}`, domainKey: 'av', lineItems, subtotal, summary };
  }, [product, modelKey, priceTier, quantity, costInputs]);

  useEffect(() => {
    if (active && result) onResultChange(result);
  }, [active, result, onResultChange]);

  if (!product) return null;

  return (
    <section className={`${styles.sectionPanel} ${active ? '' : styles.hidden}`}>
      <h2 className={styles.h2}>Interactive Flat Panel Estimator</h2>
      <div className={`${styles.row} ${styles.columns}`}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="ifpModel">Panel model</label>
          <select id="ifpModel" className={styles.formControl} value={modelKey} onChange={(e) => setModelKey(e.target.value)}>
            {modelKeys.map((key) => (
              <option key={key} value={key}>{key} — {effectiveProducts[key]?.name}</option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="ifpPriceTier">Price tier</label>
          <select id="ifpPriceTier" className={styles.formControl} value={priceTier} onChange={(e) => setPriceTier(e.target.value as Tier)}>
            <option value="distributor">Distributor price</option>
            <option value="partner">Partner price</option>
            <option value="customer">Customer price</option>
          </select>
        </div>
      </div>
      <div className={`${styles.row} ${styles.columns}`}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="ifpQuantity">Quantity</label>
          <input id="ifpQuantity" className={styles.formControl} type="number" step={1} min={1} value={quantity} onFocus={selectAllOnFocus} onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))} />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="ifpDetails">Model details</label>
          <textarea id="ifpDetails" className={styles.formControl} rows={4} readOnly value={product.description} />
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
