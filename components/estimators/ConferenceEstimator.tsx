'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { avCameraProducts, CameraProduct, CameraAccessory } from '@/lib/data/avCameraProducts';
import { formatMoney } from '@/lib/format';
import { selectAllOnFocus } from '@/lib/numberInputHelpers';
import { CostInputs, DomainResult, LineItem } from '@/lib/types';
import { applyOverride, extraProductKeys, overrideMapKey, OverrideMap } from '@/lib/catalogOverrides';
import styles from '../calculator.module.css';

export interface ModelPreset {
  nonce: number;
  modelKey: string;
}

interface ConferenceEstimatorProps {
  active: boolean;
  costInputs: CostInputs;
  onResultChange: (result: DomainResult) => void;
  presetModel?: ModelPreset | null;
  overrides: OverrideMap;
}

type Tier = 'partner' | 'distributor' | 'customer';

export default function ConferenceEstimator({ active, costInputs, onResultChange, presetModel, overrides }: ConferenceEstimatorProps) {
  const baseModelKeys = Object.keys(avCameraProducts);
  const [modelKey, setModelKey] = useState(baseModelKeys[0]);
  const [priceTier, setPriceTier] = useState<Tier>('partner');
  const [quantity, setQuantity] = useState(1);
  const [accessoryChecked, setAccessoryChecked] = useState(false);

  // Admin-added products (Product Catalog) have no entry in the hardcoded
  // avCameraProducts file — union their keys in.
  const modelKeys = useMemo(
    () => [...baseModelKeys, ...extraProductKeys('conference', baseModelKeys, overrides)].sort((a, b) => a.localeCompare(b)),
    [overrides]
  );

  const baseProduct = avCameraProducts[modelKey];
  const conferenceOverride = overrides.get(overrideMapKey('conference', modelKey));
  const product = useMemo(() => {
    if (!baseProduct && !conferenceOverride) return undefined;
    return applyOverride(baseProduct || ({} as CameraProduct), conferenceOverride, 'description');
  }, [baseProduct, conferenceOverride]);

  // An accessory can be added (via Product Catalog) to ANY existing camera,
  // even one whose hardcoded base has no `.accessory` at all — so check for
  // an override first, don't gate on `product.accessory` existing.
  const accessoryOverride = overrides.get(overrideMapKey('conference-accessory', modelKey));
  const accessory = useMemo(() => {
    if (!product?.accessory && !accessoryOverride) return undefined;
    return applyOverride(product?.accessory || ({} as CameraAccessory), accessoryOverride, 'name');
  }, [product, accessoryOverride]);

  useEffect(() => {
    if (!accessory) setAccessoryChecked(false);
  }, [modelKey, accessory]);

  useEffect(() => {
    if (presetModel && avCameraProducts[presetModel.modelKey]) setModelKey(presetModel.modelKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetModel?.nonce]);

  const result = useMemo<DomainResult | null>(() => {
    if (!product) return null;
    const qty = Math.max(1, Math.round(quantity) || 1);
    const unitPrice = priceTier === 'partner' ? product.partnerPrice : priceTier === 'distributor' ? product.distributorPrice : product.customerPrice;
    const baseCost = qty * unitPrice;

    let accessoryCost = 0;
    let accessoryUnitPrice = 0;
    if (accessory && accessoryChecked) {
      accessoryUnitPrice = priceTier === 'partner' ? accessory.partnerPrice : priceTier === 'distributor' ? accessory.distributorPrice : accessory.customerPrice;
      accessoryCost = qty * accessoryUnitPrice;
    }

    const subtotal = baseCost + accessoryCost + costInputs.installationCost + costInputs.fabricationCost;

    const lineItems: LineItem[] = [{ description: `${modelKey} — ${product.description}`, qty, rate: unitPrice, amount: baseCost, unit: 'Nos' }];
    if (accessoryCost) lineItems.push({ description: accessory!.name, qty, rate: accessoryUnitPrice, amount: accessoryCost, unit: 'Nos' });
    if (costInputs.installationCost) lineItems.push({ description: 'Additional installation cost', qty: 1, rate: costInputs.installationCost, amount: costInputs.installationCost, unit: 'Nos' });
    if (costInputs.fabricationCost) lineItems.push({ description: 'Additional fabrication cost', qty: 1, rate: costInputs.fabricationCost, amount: costInputs.fabricationCost, unit: 'Nos' });

    const tierLabel = priceTier === 'partner' ? 'Partner price' : priceTier === 'distributor' ? 'Distributor price' : 'Customer price';
    const summary = [
      { label: 'Device model', value: modelKey },
      { label: 'Price tier', value: tierLabel },
      { label: 'Quantity', value: String(qty) },
      { label: 'Unit price', value: formatMoney(unitPrice) },
      { label: 'Base cost', value: formatMoney(baseCost) },
      ...(accessoryCost ? [{ label: 'Wireless dongle accessory', value: formatMoney(accessoryCost) }] : []),
      ...(costInputs.installationCost ? [{ label: 'Installation cost', value: formatMoney(costInputs.installationCost) }] : []),
      ...(costInputs.fabricationCost ? [{ label: 'Fabrication cost', value: formatMoney(costInputs.fabricationCost) }] : [])
    ];

    return { label: `Conferencing — ${modelKey}`, domainKey: 'av', lineItems, subtotal, summary };
  }, [product, accessory, modelKey, priceTier, quantity, accessoryChecked, costInputs]);

  useEffect(() => {
    if (active && result) onResultChange(result);
  }, [active, result, onResultChange]);

  if (!product) return null;

  return (
    <section className={`${styles.sectionPanel} ${active ? '' : styles.hidden}`}>
      <h2 className={styles.h2}>Conferencing Camera &amp; Microphone Estimator</h2>
      <div className={`${styles.row} ${styles.columns}`}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="conferenceModel">Device model</label>
          <select id="conferenceModel" className={styles.formControl} value={modelKey} onChange={(e) => setModelKey(e.target.value)}>
            {modelKeys.map((key) => {
              const merged = applyOverride(avCameraProducts[key] || ({} as CameraProduct), overrides.get(overrideMapKey('conference', key)), 'description');
              return <option key={key} value={key}>{key} — {merged.modelTag}</option>;
            })}
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="conferencePriceTier">Price tier</label>
          <select id="conferencePriceTier" className={styles.formControl} value={priceTier} onChange={(e) => setPriceTier(e.target.value as Tier)}>
            <option value="partner">Partner price</option>
            <option value="distributor">Distributor price</option>
            <option value="customer">Customer price</option>
          </select>
        </div>
      </div>
      <div className={`${styles.row} ${styles.columns}`}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="conferenceQuantity">Quantity</label>
          <input id="conferenceQuantity" className={styles.formControl} type="number" step={1} min={1} value={quantity} onFocus={selectAllOnFocus} onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))} />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="conferenceDetails">Model details</label>
          <textarea id="conferenceDetails" className={styles.formControl} rows={4} readOnly value={`${product.description}\nModel: ${product.modelTag}\nCategory: ${product.category || ''}`} />
        </div>
      </div>
      {accessory && (
        <div className={`${styles.row} ${styles.columns}`}>
          <div className={styles.field}>
            <label className={`${styles.label} ${styles.inlineFlexGap8} ${styles.cursorPointerBold}`}>
              <input type="checkbox" checked={accessoryChecked} onChange={(e) => setAccessoryChecked(e.target.checked)} />
              <span>{accessory.name}</span>
            </label>
          </div>
        </div>
      )}
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
