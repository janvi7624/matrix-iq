'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { standeeModels, STANDEE_CATEGORIES, STANDEE_PREVIEW_BY_CATEGORY } from '@/lib/data/standeeModels';
import { formatMoney } from '@/lib/format';
import { selectAllOnFocus } from '@/lib/numberInputHelpers';
import { CostInputs, DomainResult, LineItem } from '@/lib/types';
import styles from '../calculator.module.css';

interface StandeeEstimatorProps {
  active: boolean;
  costInputs: CostInputs;
  onResultChange: (result: DomainResult) => void;
}

function firstModelForCategory(category: string): string {
  return Object.keys(standeeModels).find((key) => standeeModels[key].category === category) || '';
}

export default function StandeeEstimator({ active, costInputs, onResultChange }: StandeeEstimatorProps) {
  const [category, setCategory] = useState<string>(STANDEE_CATEGORIES[0]);
  const [modelKey, setModelKey] = useState<string>(() => firstModelForCategory(STANDEE_CATEGORIES[0]));
  const [priceTier, setPriceTier] = useState<'partner' | 'endUser'>('partner');
  const [quantity, setQuantity] = useState(1);
  const [installationPerUnit, setInstallationPerUnit] = useState(() => standeeModels[modelKey]?.installationPerUnit || 0);
  const [fabricationPerUnit, setFabricationPerUnit] = useState(() => standeeModels[modelKey]?.fabricationPerUnit || 0);
  const [scaffoldingPerUnit, setScaffoldingPerUnit] = useState(() => standeeModels[modelKey]?.scaffoldingPerUnit || 0);

  useEffect(() => {
    if (standeeModels[modelKey]?.category !== category) {
      setModelKey(firstModelForCategory(category));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  // Reload the per-unit cost defaults whenever the model changes, but leave
  // them editable in between so a rep can override for a specific quote.
  useEffect(() => {
    const m = standeeModels[modelKey];
    if (!m) return;
    setInstallationPerUnit(m.installationPerUnit);
    setFabricationPerUnit(m.fabricationPerUnit);
    setScaffoldingPerUnit(m.scaffoldingPerUnit);
  }, [modelKey]);

  const model = standeeModels[modelKey];

  const result = useMemo<DomainResult | null>(() => {
    if (!model) return null;
    const qty = Math.max(1, Math.round(quantity) || 1);
    const selectedPrice = priceTier === 'partner' ? model.partnerPrice : model.endUserPrice;
    const baseCost = qty * selectedPrice;
    const fabricationUnit = qty * fabricationPerUnit;
    const installationUnit = qty * installationPerUnit;
    const scaffoldingUnit = qty * scaffoldingPerUnit;
    const fabrication = fabricationUnit + costInputs.fabricationCost;
    const installation = installationUnit + costInputs.installationCost;
    const scaffolding = scaffoldingUnit + costInputs.scaffoldingCost;
    const subtotal = baseCost + fabrication + installation + scaffolding;

    const lineItems: LineItem[] = [
      { description: `${modelKey} — ${model.details}`, qty, rate: selectedPrice, amount: baseCost, unit: 'Nos' },
      { description: 'Installation', qty, rate: installationPerUnit, amount: installationUnit, unit: 'Nos' }
    ];
    if (costInputs.installationCost) {
      lineItems.push({ description: 'Additional installation cost', qty: 1, rate: costInputs.installationCost, amount: costInputs.installationCost, unit: 'Nos' });
    }
    lineItems.push({ description: 'Fabrication', qty, rate: fabricationPerUnit, amount: fabricationUnit, unit: 'Nos' });
    if (costInputs.fabricationCost) {
      lineItems.push({ description: 'Additional fabrication cost', qty: 1, rate: costInputs.fabricationCost, amount: costInputs.fabricationCost, unit: 'Nos' });
    }
    lineItems.push({ description: 'Scaffolding', qty, rate: scaffoldingPerUnit, amount: scaffoldingUnit, unit: 'Nos' });
    if (costInputs.scaffoldingCost) {
      lineItems.push({ description: 'Additional scaffolding cost', qty: 1, rate: costInputs.scaffoldingCost, amount: costInputs.scaffoldingCost, unit: 'Nos' });
    }

    const summary = [
      { label: 'Standee model', value: modelKey },
      { label: 'Price tier', value: priceTier === 'partner' ? 'Partner' : 'End-user MRP' },
      { label: 'Quantity', value: String(qty) },
      { label: 'Unit price', value: formatMoney(selectedPrice) },
      { label: 'Base cost', value: formatMoney(baseCost) },
      { label: 'Installation cost', value: formatMoney(installation) },
      { label: 'Fabrication cost', value: formatMoney(fabrication) },
      { label: 'Scaffolding cost', value: formatMoney(scaffolding) }
    ];

    return { label: `Standee — ${modelKey}`, domainKey: 'av', lineItems, subtotal, summary };
  }, [model, modelKey, priceTier, quantity, costInputs, installationPerUnit, fabricationPerUnit, scaffoldingPerUnit]);

  useEffect(() => {
    if (active && result) onResultChange(result);
  }, [active, result, onResultChange]);

  if (!model) return null;

  const previewSrc = STANDEE_PREVIEW_BY_CATEGORY[category] || '/WALLmOUNT.jpg';

  return (
    <section className={`${styles.sectionPanel} ${active ? '' : styles.hidden}`}>
      <h2 className={styles.h2}>Standee Estimator</h2>
      <div className={`${styles.row} ${styles.columns}`}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="standeeCategory">Standee type</label>
          <select id="standeeCategory" className={styles.formControl} value={category} onChange={(e) => setCategory(e.target.value)}>
            {STANDEE_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="standeeModel">Standee model</label>
          <select id="standeeModel" className={styles.formControl} value={modelKey} onChange={(e) => setModelKey(e.target.value)}>
            {Object.keys(standeeModels)
              .filter((key) => standeeModels[key].category === category)
              .map((key) => (
                <option key={key} value={key}>{key}</option>
              ))}
          </select>
        </div>
      </div>
      <div className={`${styles.row} ${styles.columns}`}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="standeePriceTier">Price tier</label>
          <select id="standeePriceTier" className={styles.formControl} value={priceTier} onChange={(e) => setPriceTier(e.target.value as 'partner' | 'endUser')}>
            <option value="partner">Partner price</option>
            <option value="endUser">End-user MRP</option>
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="standeeQuantity">Quantity</label>
          <input id="standeeQuantity" className={styles.formControl} type="number" step={1} min={1} value={quantity} onFocus={selectAllOnFocus} onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))} />
        </div>
      </div>
      <div className={`${styles.row} ${styles.columns}`}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="standeeDetails">Model details</label>
          <textarea
            id="standeeDetails"
            className={styles.formControl}
            rows={4}
            readOnly
            value={`${model.details}\nCategory: ${model.category}\nSize: ${model.size}`}
          />
        </div>
        <div className={`${styles.field} ${styles.standeePreview}`}>
          <label className={styles.label}>Preview</label>
          <div className={styles.imageHolder}>
            <Image src={previewSrc} alt={`${category} preview`} width={220} height={220} className={styles.previewImg} unoptimized />
          </div>
        </div>
      </div>
      <div className={`${styles.row} ${styles.columns}`}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="standeeInstallationPerUnit">Installation cost / unit</label>
          <input
            id="standeeInstallationPerUnit"
            className={styles.formControl}
            type="number"
            step="any"
            min={0}
            value={installationPerUnit}
            onFocus={selectAllOnFocus}
            onChange={(e) => setInstallationPerUnit(parseFloat(e.target.value) || 0)}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="standeeFabricationPerUnit">Fabrication cost / unit</label>
          <input
            id="standeeFabricationPerUnit"
            className={styles.formControl}
            type="number"
            step="any"
            min={0}
            value={fabricationPerUnit}
            onFocus={selectAllOnFocus}
            onChange={(e) => setFabricationPerUnit(parseFloat(e.target.value) || 0)}
          />
        </div>
      </div>
      <div className={styles.row}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="standeeScaffoldingPerUnit">Scaffolding cost / unit</label>
          <input
            id="standeeScaffoldingPerUnit"
            className={styles.formControl}
            type="number"
            step="any"
            min={0}
            value={scaffoldingPerUnit}
            onFocus={selectAllOnFocus}
            onChange={(e) => setScaffoldingPerUnit(parseFloat(e.target.value) || 0)}
          />
        </div>
      </div>
    </section>
  );
}
