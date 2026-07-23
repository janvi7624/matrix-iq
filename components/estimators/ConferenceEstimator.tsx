'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { avCameraProducts } from '@/lib/data/avCameraProducts';
import { formatMoney } from '@/lib/format';
import { CostInputs, DomainResult, LineItem } from '@/lib/types';
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
}

type Tier = 'partner' | 'distributor' | 'customer';

export default function ConferenceEstimator({ active, costInputs, onResultChange, presetModel }: ConferenceEstimatorProps) {
  const modelKeys = Object.keys(avCameraProducts);
  const [modelKey, setModelKey] = useState(modelKeys[0]);
  const [priceTier, setPriceTier] = useState<Tier>('partner');
  const [quantity, setQuantity] = useState(1);
  const [accessoryChecked, setAccessoryChecked] = useState(false);

  const product = avCameraProducts[modelKey];

  useEffect(() => {
    if (!product?.accessory) setAccessoryChecked(false);
  }, [modelKey, product]);

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
    if (product.accessory && accessoryChecked) {
      accessoryUnitPrice = priceTier === 'partner' ? product.accessory.partnerPrice : priceTier === 'distributor' ? product.accessory.distributorPrice : product.accessory.customerPrice;
      accessoryCost = qty * accessoryUnitPrice;
    }

    const subtotal = baseCost + accessoryCost + costInputs.installationCost + costInputs.fabricationCost;

    const lineItems: LineItem[] = [{ description: `${modelKey} — ${product.description}`, qty, rate: unitPrice, amount: baseCost, unit: 'Nos' }];
    if (accessoryCost) lineItems.push({ description: product.accessory!.name, qty, rate: accessoryUnitPrice, amount: accessoryCost, unit: 'Nos' });
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
  }, [product, modelKey, priceTier, quantity, accessoryChecked, costInputs]);

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
            {modelKeys.map((key) => (
              <option key={key} value={key}>{key} — {avCameraProducts[key].modelTag}</option>
            ))}
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
          <input id="conferenceQuantity" className={styles.formControl} type="number" step={1} min={1} value={quantity} onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))} />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="conferenceDetails">Model details</label>
          <textarea id="conferenceDetails" className={styles.formControl} rows={4} readOnly value={`${product.description}\nModel: ${product.modelTag}\nCategory: ${product.category || ''}`} />
        </div>
      </div>
      {product.accessory && (
        <div className={`${styles.row} ${styles.columns}`}>
          <div className={styles.field}>
            <label className={styles.label} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={accessoryChecked} onChange={(e) => setAccessoryChecked(e.target.checked)} />
              <span>{product.accessory.name}</span>
            </label>
          </div>
        </div>
      )}
      <div className={`${styles.row} ${styles.columns}`}>
        <div className={`${styles.field} ${styles.standeePreview}`}>
          <label className={styles.label}>Preview</label>
          <div className={styles.imageHolder}>
            <Image src={product.image} alt={`${modelKey} preview`} width={220} height={220} className={styles.previewImg} unoptimized />
          </div>
        </div>
      </div>
    </section>
  );
}
