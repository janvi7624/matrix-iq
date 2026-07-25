'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AI_SLAB_LABELS, aiAnalytics, getAiSlabIndex } from '@/lib/data/aiAnalytics';
import { AI_SALES_GUIDELINES, AI_SETUP_COST_BY_SLAB, AI_WORKED_EXAMPLE, aiBundles, resolveBundleFeatureNames } from '@/lib/data/aiBundles';
import { formatMoney, slugify } from '@/lib/format';
import { DomainResult, LineItem } from '@/lib/types';
import styles from '../calculator.module.css';

interface AiAnalyticsEstimatorProps {
  active: boolean;
  onResultChange: (result: DomainResult) => void;
}

type PricingMode = 'ala-carte' | 'bundle';
type BillingCycle = 'yearly' | 'monthly';

export default function AiAnalyticsEstimator({ active, onResultChange }: AiAnalyticsEstimatorProps) {
  const [cameraCount, setCameraCount] = useState(25);
  const [oneTimeCost, setOneTimeCost] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [categoryJump, setCategoryJump] = useState('');
  const [pricingMode, setPricingMode] = useState<PricingMode>('ala-carte');
  const [bundleIndex, setBundleIndex] = useState(1); // default to "Advanced Security"
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('yearly');
  const categoryRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const effectiveCameraCount = Math.max(1, Math.round(cameraCount) || 1);
  const slabIndex = getAiSlabIndex(effectiveCameraCount);
  const billingDivisor = billingCycle === 'monthly' ? 12 : 1;
  const periodLabel = billingCycle === 'monthly' ? 'month' : 'year';
  const periodUnitSuffix = billingCycle === 'monthly' ? '/cam/mo' : '/cam/yr';
  const recommendedSetupCost = AI_SETUP_COST_BY_SLAB[slabIndex];

  const categories = useMemo(() => {
    const seen: string[] = [];
    aiAnalytics.forEach((f) => {
      if (!seen.includes(f.category)) seen.push(f.category);
    });
    return seen;
  }, []);

  const selectedBundle = aiBundles[bundleIndex] || aiBundles[0];

  const result = useMemo<DomainResult | null>(() => {
    let analyticsSubtotal = 0;
    const lineItems: LineItem[] = [];
    let label = `AI Video Analytics — ${effectiveCameraCount} cameras`;

    if (pricingMode === 'bundle') {
      const bundleFeatures = resolveBundleFeatureNames(selectedBundle);
      const rate = selectedBundle.tiers[slabIndex] / billingDivisor;
      const amount = rate * effectiveCameraCount;
      analyticsSubtotal += amount;
      lineItems.push({
        description: `${selectedBundle.name} bundle (${bundleFeatures.length} analytics: ${bundleFeatures.join(', ')})`,
        qty: effectiveCameraCount,
        rate,
        amount,
        unit: `License${periodUnitSuffix}`
      });
      label = `AI Video Analytics — ${selectedBundle.name} bundle — ${effectiveCameraCount} cameras`;
    } else {
      aiAnalytics.forEach((feature, index) => {
        if (!selected.has(index)) return;
        const rate = feature.tiers[slabIndex] / billingDivisor;
        const amount = rate * effectiveCameraCount;
        analyticsSubtotal += amount;
        lineItems.push({ description: `${feature.name} (${feature.category})`, qty: effectiveCameraCount, rate, amount, unit: `License${periodUnitSuffix}` });
      });
    }

    const oneTime = Number(oneTimeCost) || 0;
    if (oneTime) lineItems.push({ description: 'One-time implementation & configuration', qty: 1, rate: oneTime, amount: oneTime, unit: 'Nos' });

    const summary = [
      { label: 'Cameras', value: String(effectiveCameraCount) },
      { label: 'Volume slab', value: AI_SLAB_LABELS[slabIndex] },
      { label: 'Pricing mode', value: pricingMode === 'bundle' ? `Bundle — ${selectedBundle.name}` : 'À-la-carte' },
      { label: 'Billing cycle', value: billingCycle === 'monthly' ? 'Monthly' : 'Yearly' },
      ...(pricingMode === 'ala-carte' ? [{ label: 'Analytics selected', value: String(selected.size) }] : []),
      { label: `Analytics subtotal (per ${periodLabel})`, value: formatMoney(analyticsSubtotal) },
      ...(oneTime ? [{ label: 'One-time implementation cost', value: formatMoney(oneTime) }] : [])
    ];

    return { label, domainKey: 'ai', lineItems, subtotal: analyticsSubtotal + oneTime, summary };
  }, [pricingMode, selectedBundle, selected, slabIndex, effectiveCameraCount, oneTimeCost, billingDivisor, periodLabel, periodUnitSuffix, billingCycle]);

  useEffect(() => {
    if (active && result) onResultChange(result);
  }, [active, result, onResultChange]);

  const toggleFeature = (index: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  return (
    <section className={`${styles.sectionPanel} ${active ? '' : styles.hidden}`}>
      <h2 className={styles.h2}>AI Video Analytics Estimator</h2>
      <div className={`${styles.row} ${styles.columns}`}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="aiCameraCount">Number of cameras</label>
          <input id="aiCameraCount" className={styles.formControl} type="number" step={1} min={1} value={cameraCount} onChange={(e) => setCameraCount(parseInt(e.target.value, 10) || 1)} />
        </div>
        <div className={styles.field}>
          <label className={styles.label}>Volume slab</label>
          <div className={styles.small} style={{ paddingTop: 10 }}>{AI_SLAB_LABELS[slabIndex]}</div>
        </div>
      </div>

      <div className={`${styles.row} ${styles.columns}`}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="aiPricingMode">Pricing mode</label>
          <select id="aiPricingMode" className={styles.formControl} value={pricingMode} onChange={(e) => setPricingMode(e.target.value as PricingMode)}>
            <option value="ala-carte">À-la-carte (pick individual analytics)</option>
            <option value="bundle">Bundle (recommended package, best savings)</option>
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="aiBillingCycle">Billing cycle</label>
          <select id="aiBillingCycle" className={styles.formControl} value={billingCycle} onChange={(e) => setBillingCycle(e.target.value as BillingCycle)}>
            <option value="yearly">Yearly (list price)</option>
            <option value="monthly">Monthly (annual rate ÷ 12)</option>
          </select>
        </div>
      </div>

      {pricingMode === 'bundle' && (
        <div className={styles.domainPanel}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="aiBundleSelect">Bundle package</label>
            <select id="aiBundleSelect" className={styles.formControl} value={bundleIndex} onChange={(e) => setBundleIndex(parseInt(e.target.value, 10))}>
              {aiBundles.map((b, i) => (
                <option key={b.name} value={i}>{b.name} — {b.includedFeatureNames.length || aiAnalytics.length} analytics</option>
              ))}
            </select>
          </div>
          <p className={styles.small} style={{ marginTop: 8 }}>{selectedBundle.description}</p>
          <p className={styles.small}>
            Includes: {resolveBundleFeatureNames(selectedBundle).join(', ')}
          </p>
          <div className={styles.lineItemRow}>
            <span style={{ flex: 1 }}>
              Bundle price at {AI_SLAB_LABELS[slabIndex]}: <strong>{formatMoney(selectedBundle.tiers[slabIndex] / billingDivisor)}{periodUnitSuffix}</strong>
              {' '}(à-la-carte value {formatMoney(selectedBundle.aLaCarteValue)}/cam/yr — save {selectedBundle.savingsPercent}%)
            </span>
          </div>
        </div>
      )}

      <div className={`${styles.row} ${styles.columns}`}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="aiOneTimeCost">One-time implementation &amp; configuration cost (₹)</label>
          <input id="aiOneTimeCost" className={styles.formControl} type="number" step="any" min={0} value={oneTimeCost} onChange={(e) => setOneTimeCost(parseFloat(e.target.value) || 0)} />
          <div className={styles.small} style={{ marginTop: 6 }}>
            Recommended for {AI_SLAB_LABELS[slabIndex]}: {formatMoney(recommendedSetupCost)}{' '}
            <button type="button" className={styles.secondaryButton} onClick={() => setOneTimeCost(recommendedSetupCost)}>
              Use this
            </button>
          </div>
        </div>
        {pricingMode === 'ala-carte' && (
          <div className={styles.field}>
            <label className={styles.label} htmlFor="aiCategoryJump">Jump to detection category</label>
            <select
              id="aiCategoryJump"
              className={styles.formControl}
              value={categoryJump}
              onChange={(e) => {
                const value = e.target.value;
                setCategoryJump(value);
                if (value) categoryRefs.current[value]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            >
              <option value="">Select category…</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <p className={styles.small}>
        List pricing, exclusive of 18% GST. Volume slab is based on the total camera count above. The Nanta VMS dashboard is included at no
        separate license cost — the one-time cost above covers integration, configuration, installation &amp; training only. On-premise hardware
        (servers, GPU, storage, networking) is quoted separately.
      </p>

      {pricingMode === 'ala-carte' && (
        <div className={styles.field}>
          <label className={styles.label}>Select analytics features</label>
          <div className={styles.aiFeatureList}>
            {(() => {
              let lastCategory: string | null = null;
              return aiAnalytics.map((feature, index) => {
                const showHeading = feature.category !== lastCategory;
                lastCategory = feature.category;
                return (
                  <div key={feature.name}>
                    {showHeading && (
                      <div
                        className={styles.aiFeatureCategory}
                        id={`ai-cat-${slugify(feature.category)}`}
                        ref={(el) => {
                          categoryRefs.current[feature.category] = el;
                        }}
                      >
                        {feature.category}
                      </div>
                    )}
                    <label className={styles.aiFeatureItem}>
                      <input type="checkbox" className={styles.aiFeatureCheckbox} checked={selected.has(index)} onChange={() => toggleFeature(index)} />
                      <div className={styles.aiFeatureInfo}>
                        <div className={styles.aiFeatureName}>{feature.name}</div>
                        <div className={styles.aiFeatureDesc}>{feature.desc}</div>
                      </div>
                      <div className={styles.aiFeaturePrice}>{formatMoney(feature.tiers[slabIndex] / billingDivisor)}{periodUnitSuffix}</div>
                    </label>
                  </div>
                );
              });
            })()}
          </div>
        </div>
      )}

      <details className={styles.domainPanel} style={{ marginTop: 14 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Sample commercial — worked example ({AI_WORKED_EXAMPLE.cameras} cameras, {AI_WORKED_EXAMPLE.bundleName} bundle)</summary>
        <div className={styles.small} style={{ marginTop: 8 }}>Fixed reference example — not tied to your current inputs above.</div>
        <div className={styles.lineItemRow}><span style={{ flex: 1 }}>No. of cameras</span><span>{AI_WORKED_EXAMPLE.cameras}</span></div>
        <div className={styles.lineItemRow}><span style={{ flex: 1 }}>Bundle selected</span><span>{AI_WORKED_EXAMPLE.bundleName}</span></div>
        <div className={styles.lineItemRow}><span style={{ flex: 1 }}>Applicable volume slab</span><span>{AI_WORKED_EXAMPLE.slabLabel}</span></div>
        <div className={styles.lineItemRow}><span style={{ flex: 1 }}>Bundle price (₹/cam/yr)</span><span>{formatMoney(AI_WORKED_EXAMPLE.bundlePricePerCameraYear)}</span></div>
        <div className={styles.lineItemRow}><span style={{ flex: 1 }}>Annual analytics subscription</span><span>{formatMoney(AI_WORKED_EXAMPLE.annualSubscription)}</span></div>
        <div className={styles.lineItemRow}><span style={{ flex: 1 }}>One-time setup (61–100)</span><span>{formatMoney(AI_WORKED_EXAMPLE.oneTimeSetup)}</span></div>
        <div className={styles.lineItemRow}><span style={{ flex: 1 }}>Year-1 total (before GST)</span><span>{formatMoney(AI_WORKED_EXAMPLE.year1TotalBeforeGst)}</span></div>
        <div className={styles.lineItemRow}><span style={{ flex: 1 }}>GST @ 18%</span><span>{formatMoney(AI_WORKED_EXAMPLE.gstAmount)}</span></div>
        <div className={styles.lineItemRow}><span style={{ flex: 1 }}><strong>Year-1 total (incl. GST)</strong></span><span><strong>{formatMoney(AI_WORKED_EXAMPLE.year1TotalInclGst)}</strong></span></div>
        <div className={styles.lineItemRow}><span style={{ flex: 1 }}>Year-2 onward (subscription + optional AMC, before GST)</span><span>{formatMoney(AI_WORKED_EXAMPLE.year2OnwardBeforeGst)}</span></div>
      </details>

      <details className={styles.domainPanel} style={{ marginTop: 10 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Sales &amp; quoting guidelines</summary>
        <ul style={{ marginTop: 8, paddingLeft: 18 }}>
          {AI_SALES_GUIDELINES.map((line) => (
            <li key={line} className={styles.small} style={{ marginBottom: 4 }}>{line}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}
