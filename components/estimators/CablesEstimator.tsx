'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { CABLE_SERIES, cableProducts } from '@/lib/data/cableProducts';
import { formatMoney } from '@/lib/format';
import { CostInputs, DomainResult, LineItem } from '@/lib/types';
import { ModelPreset } from './ConferenceEstimator';
import styles from '../calculator.module.css';

interface CablesEstimatorProps {
  active: boolean;
  costInputs: CostInputs;
  onResultChange: (result: DomainResult) => void;
  presetModel?: ModelPreset | null;
}

type Tier = 'distributor' | 'partner' | 'customer';

function firstModelForSeries(seriesKey: string): string {
  return (
    Object.keys(cableProducts)
      .filter((key) => cableProducts[key].series === seriesKey)
      .sort((a, b) => cableProducts[a].lengthMeters - cableProducts[b].lengthMeters)[0] || ''
  );
}

export default function CablesEstimator({ active, costInputs, onResultChange, presetModel }: CablesEstimatorProps) {
  const seriesKeys = Object.keys(CABLE_SERIES);
  const [seriesKey, setSeriesKey] = useState(seriesKeys[0]);
  const [modelKey, setModelKey] = useState<string>(() => firstModelForSeries(seriesKeys[0]));
  const [priceTier, setPriceTier] = useState<Tier>('distributor');
  const [quantity, setQuantity] = useState(1);

  useEffect(() => {
    if (cableProducts[modelKey]?.series !== seriesKey) {
      setModelKey(firstModelForSeries(seriesKey));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesKey]);

  useEffect(() => {
    const presetProduct = presetModel ? cableProducts[presetModel.modelKey] : undefined;
    if (presetProduct) {
      setSeriesKey(presetProduct.series);
      setModelKey(presetModel!.modelKey);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetModel?.nonce]);

  const product = cableProducts[modelKey];
  const series = product ? CABLE_SERIES[product.series] : undefined;

  const result = useMemo<DomainResult | null>(() => {
    if (!product || !series) return null;
    const qty = Math.max(1, Math.round(quantity) || 1);
    const unitPrice = priceTier === 'distributor' ? product.distributorPrice : priceTier === 'partner' ? product.partnerPrice : product.customerPrice;
    const baseCost = qty * unitPrice;
    const subtotal = baseCost + costInputs.installationCost + costInputs.fabricationCost;

    const lineItems: LineItem[] = [{ description: `${modelKey} — ${series.name} (${product.length})`, qty, rate: unitPrice, amount: baseCost, unit: 'Nos' }];
    if (costInputs.installationCost) lineItems.push({ description: 'Additional installation cost', qty: 1, rate: costInputs.installationCost, amount: costInputs.installationCost, unit: 'Nos' });
    if (costInputs.fabricationCost) lineItems.push({ description: 'Additional fabrication cost', qty: 1, rate: costInputs.fabricationCost, amount: costInputs.fabricationCost, unit: 'Nos' });

    const tierLabel = priceTier === 'distributor' ? 'Distributor price' : priceTier === 'partner' ? 'Partner price' : 'Customer price';
    const summary = [
      { label: 'Cable', value: `${modelKey} (${product.length})` },
      { label: 'Cable type', value: series.name },
      { label: 'Price tier', value: tierLabel },
      { label: 'Quantity', value: String(qty) },
      { label: 'Unit price', value: formatMoney(unitPrice) },
      { label: 'Base cost', value: formatMoney(baseCost) },
      ...(costInputs.installationCost ? [{ label: 'Installation cost', value: formatMoney(costInputs.installationCost) }] : []),
      ...(costInputs.fabricationCost ? [{ label: 'Fabrication cost', value: formatMoney(costInputs.fabricationCost) }] : [])
    ];

    return { label: `AV Cable — ${modelKey}`, domainKey: 'av', lineItems, subtotal, summary };
  }, [product, series, modelKey, priceTier, quantity, costInputs]);

  useEffect(() => {
    if (active && result) onResultChange(result);
  }, [active, result, onResultChange]);

  if (!product || !series) return null;

  return (
    <section className={`${styles.sectionPanel} ${active ? '' : styles.hidden}`}>
      <h2 className={styles.h2}>AV Cable Estimator</h2>
      <div className={`${styles.row} ${styles.columns}`}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="cableSeriesSelect">Cable type</label>
          <select id="cableSeriesSelect" className={styles.formControl} value={seriesKey} onChange={(e) => setSeriesKey(e.target.value)}>
            {seriesKeys.map((key) => (
              <option key={key} value={key}>{CABLE_SERIES[key].name}</option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="cableModel">Length / SKU</label>
          <select id="cableModel" className={styles.formControl} value={modelKey} onChange={(e) => setModelKey(e.target.value)}>
            {Object.keys(cableProducts)
              .filter((key) => cableProducts[key].series === seriesKey)
              .sort((a, b) => cableProducts[a].lengthMeters - cableProducts[b].lengthMeters)
              .map((key) => (
                <option key={key} value={key}>{key} — {cableProducts[key].length}</option>
              ))}
          </select>
        </div>
      </div>
      <div className={`${styles.row} ${styles.columns}`}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="cablePriceTier">Price tier</label>
          <select id="cablePriceTier" className={styles.formControl} value={priceTier} onChange={(e) => setPriceTier(e.target.value as Tier)}>
            <option value="distributor">Distributor price</option>
            <option value="partner">Partner price</option>
            <option value="customer">Customer price</option>
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="cableQuantity">Quantity</label>
          <input id="cableQuantity" className={styles.formControl} type="number" step={1} min={1} value={quantity} onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))} />
        </div>
      </div>
      <div className={`${styles.row} ${styles.columns}`}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="cableDetails">Model details</label>
          <textarea id="cableDetails" className={styles.formControl} rows={4} readOnly value={product.description} />
        </div>
        <div className={`${styles.field} ${styles.standeePreview}`}>
          <label className={styles.label}>Preview</label>
          <div className={styles.imageHolder}>
            <Image src={series.image} alt={series.name} width={220} height={220} className={styles.previewImg} unoptimized />
          </div>
        </div>
      </div>
    </section>
  );
}
