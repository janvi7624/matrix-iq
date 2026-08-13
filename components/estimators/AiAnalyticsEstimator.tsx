'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AI_SLAB_LABELS, aiAnalytics, AiAnalyticsFeature, getAiSlabIndex } from '@/lib/data/aiAnalytics';
import { AI_SALES_GUIDELINES, AI_SETUP_COST_BY_SLAB, AI_WORKED_EXAMPLE, aiBundles, AiBundle, resolveBundleFeatureNames } from '@/lib/data/aiBundles';
import { formatMoney, slugify } from '@/lib/format';
import { selectAllOnFocus } from '@/lib/numberInputHelpers';
import { DomainResult, LineItem } from '@/lib/types';
import { applyOverride, extraProductKeys, overrideMapKey, OverrideMap } from '@/lib/catalogOverrides';
import styles from '../calculator.module.css';

interface AiAnalyticsEstimatorProps {
  active: boolean;
  onResultChange: (result: DomainResult) => void;
  canEditPricing: boolean;
  overrides: OverrideMap;
}

type PricingMode = 'ala-carte' | 'bundle' | 'custom-bundle';
type BillingCycle = 'yearly' | 'monthly' | 'onetime';
type InfraCostMode = 'none' | 'hardware' | 'cloud' | 'client';

const CUSTOM_BUNDLE_MIN_FEATURES = 3;
const CUSTOM_BUNDLE_DISCOUNT_PERCENT = 40;

export default function AiAnalyticsEstimator({ active, onResultChange, canEditPricing, overrides }: AiAnalyticsEstimatorProps) {
  const [cameraCount, setCameraCount] = useState(25);
  const [oneTimeCost, setOneTimeCost] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [categoryJump, setCategoryJump] = useState('');
  const [pricingMode, setPricingMode] = useState<PricingMode>('ala-carte');
  const [bundleIndex, setBundleIndex] = useState(1); // default to "Advanced Security"
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('yearly');
  const [includeAmc, setIncludeAmc] = useState(true);
  const [amcPercent, setAmcPercent] = useState(20);
  const [infraCostMode, setInfraCostMode] = useState<InfraCostMode>('none');
  const [hardwareCost, setHardwareCost] = useState(0);
  const [cloudCost, setCloudCost] = useState(0);
  const [detectionOverrides, setDetectionOverrides] = useState<Record<number, number>>({});
  const categoryRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const effectiveCameraCount = Math.max(1, Math.round(cameraCount) || 1);
  const slabIndex = getAiSlabIndex(effectiveCameraCount);
  const billingDivisor = billingCycle === 'monthly' ? 12 : 1;
  const periodLabel = billingCycle === 'monthly' ? 'month' : 'year';
  const periodUnitSuffix = billingCycle === 'monthly' ? '/cam/mo' : billingCycle === 'onetime' ? '/cam (one-time)' : '/cam/yr';
  const recommendedSetupCost = AI_SETUP_COST_BY_SLAB[slabIndex];

  // Non-privileged viewers can't be in a mode they can't select — defensive
  // reset if role context ever changes mid-session.
  useEffect(() => {
    if (!canEditPricing && pricingMode === 'custom-bundle') setPricingMode('ala-carte');
  }, [canEditPricing, pricingMode]);

  // Admin-added features/bundles (Product Catalog) have no entry in the
  // hardcoded aiAnalytics/aiBundles arrays — append a synthetic entry built
  // entirely from the override's `fields` (which, for a brand-new product,
  // carries the complete record, not a partial patch).
  const effectiveAnalytics = useMemo(() => {
    const base = aiAnalytics.map((f) => applyOverride(f, overrides.get(overrideMapKey('ai-analytics', f.name)), null));
    const extraNames = extraProductKeys('ai-analytics', aiAnalytics.map((f) => f.name), overrides);
    const extra = extraNames.map((name) => applyOverride({} as AiAnalyticsFeature, overrides.get(overrideMapKey('ai-analytics', name)), null));
    return [...base, ...extra];
  }, [overrides]);
  const effectiveBundles = useMemo(() => {
    const base = aiBundles.map((b) => applyOverride(b, overrides.get(overrideMapKey('ai-bundles', b.name)), 'name'));
    const extraNames = extraProductKeys('ai-bundles', aiBundles.map((b) => b.name), overrides);
    const extra = extraNames.map((name) => applyOverride({} as AiBundle, overrides.get(overrideMapKey('ai-bundles', name)), 'name'));
    return [...base, ...extra];
  }, [overrides]);

  const categories = useMemo(() => {
    const seen: string[] = [];
    effectiveAnalytics.forEach((f) => {
      if (!seen.includes(f.category)) seen.push(f.category);
    });
    return seen;
  }, [effectiveAnalytics]);

  const selectedBundle = effectiveBundles[bundleIndex] || effectiveBundles[0];

  function featureRate(feature: { tiers: [number, number, number, number, number] }, index: number): number {
    const override = detectionOverrides[index];
    if (override !== undefined) return override;
    return feature.tiers[slabIndex] / billingDivisor;
  }

  const customBundleCount = pricingMode === 'custom-bundle' ? selected.size : 0;
  const customBundleQualifies = customBundleCount >= CUSTOM_BUNDLE_MIN_FEATURES;

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
    } else if (pricingMode === 'custom-bundle') {
      if (canEditPricing && customBundleQualifies) {
        const pickedNames: string[] = [];
        let aLaCarteSum = 0;
        effectiveAnalytics.forEach((feature, index) => {
          if (!selected.has(index)) return;
          aLaCarteSum += featureRate(feature, index);
          pickedNames.push(feature.name);
        });
        const rate = aLaCarteSum * (1 - CUSTOM_BUNDLE_DISCOUNT_PERCENT / 100);
        const amount = rate * effectiveCameraCount;
        analyticsSubtotal += amount;
        lineItems.push({
          description: `Custom Bundle — sales-assembled (${pickedNames.length} analytics: ${pickedNames.join(', ')}) — ${CUSTOM_BUNDLE_DISCOUNT_PERCENT}% off list`,
          qty: effectiveCameraCount,
          rate,
          amount,
          unit: `License${periodUnitSuffix}`
        });
        label = `AI Video Analytics — Custom Bundle (${pickedNames.length} analytics) — ${effectiveCameraCount} cameras`;
      }
      // Fewer than CUSTOM_BUNDLE_MIN_FEATURES selected (or not privileged) ->
      // intentionally no line item yet; the UI below shows why.
    } else {
      effectiveAnalytics.forEach((feature, index) => {
        if (!selected.has(index)) return;
        const rate = featureRate(feature, index);
        const amount = rate * effectiveCameraCount;
        analyticsSubtotal += amount;
        lineItems.push({ description: `${feature.name} (${feature.category})`, qty: effectiveCameraCount, rate, amount, unit: `License${periodUnitSuffix}` });
      });
    }

    // AMC — only meaningful once the license is a one-time purchase; the
    // recurring yearly/monthly modes already re-bill every period, so a
    // maintenance contract on top of that would double-charge.
    let amcAmount = 0;
    if (billingCycle === 'onetime' && includeAmc && analyticsSubtotal > 0) {
      amcAmount = analyticsSubtotal * ((Number(amcPercent) || 0) / 100);
      lineItems.push({
        description: `AMC — Annual Maintenance Contract (Year 2 onward, ${amcPercent}% p.a. of license value)`,
        qty: 1,
        rate: amcAmount,
        amount: amcAmount,
        unit: 'per year'
      });
    }

    const oneTime = Number(oneTimeCost) || 0;
    if (oneTime) lineItems.push({ description: 'One-time implementation & configuration', qty: 1, rate: oneTime, amount: oneTime, unit: 'Nos' });

    let infraAmount = 0;
    if (infraCostMode === 'hardware' && hardwareCost) {
      infraAmount = Number(hardwareCost) || 0;
      lineItems.push({ description: 'Hardware / on-site server cost (one-time)', qty: 1, rate: infraAmount, amount: infraAmount, unit: 'Nos' });
    } else if (infraCostMode === 'cloud' && cloudCost) {
      infraAmount = Number(cloudCost) || 0;
      lineItems.push({ description: 'Cloud / server hosting cost', qty: 1, rate: infraAmount, amount: infraAmount, unit: 'per month' });
    }

    const summary = [
      { label: 'Cameras', value: String(effectiveCameraCount) },
      { label: 'Volume slab', value: AI_SLAB_LABELS[slabIndex] },
      {
        label: 'Pricing mode',
        value: pricingMode === 'bundle' ? `Bundle — ${selectedBundle.name}` : pricingMode === 'custom-bundle' ? `Custom Bundle (${customBundleCount} analytics)` : 'À-la-carte'
      },
      { label: 'Billing cycle', value: billingCycle === 'monthly' ? 'Monthly' : billingCycle === 'onetime' ? 'One-Time (Permanent License)' : 'Yearly' },
      ...(pricingMode === 'ala-carte' ? [{ label: 'Analytics selected', value: String(selected.size) }] : []),
      { label: `Analytics subtotal (per ${periodLabel})`, value: formatMoney(analyticsSubtotal) },
      ...(amcAmount ? [{ label: `AMC (${amcPercent}% p.a.)`, value: formatMoney(amcAmount) }] : []),
      ...(oneTime ? [{ label: 'One-time implementation cost', value: formatMoney(oneTime) }] : []),
      ...(infraCostMode === 'hardware' ? [{ label: 'Hardware cost (one-time)', value: formatMoney(infraAmount) }] : []),
      ...(infraCostMode === 'cloud' ? [{ label: 'Cloud cost (per month)', value: formatMoney(infraAmount) }] : []),
      ...(infraCostMode === 'client' ? [{ label: 'Infrastructure', value: 'Provided by client' }] : [])
    ];

    return { label, domainKey: 'ai', lineItems, subtotal: analyticsSubtotal + amcAmount + oneTime + infraAmount, summary };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    pricingMode,
    selectedBundle,
    selected,
    slabIndex,
    effectiveCameraCount,
    oneTimeCost,
    billingDivisor,
    periodLabel,
    periodUnitSuffix,
    billingCycle,
    includeAmc,
    amcPercent,
    infraCostMode,
    hardwareCost,
    cloudCost,
    detectionOverrides,
    canEditPricing,
    customBundleQualifies,
    customBundleCount,
    effectiveAnalytics,
    effectiveBundles
  ]);

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

  const showFeaturePicker = pricingMode === 'ala-carte' || pricingMode === 'custom-bundle';

  return (
    <section className={`${styles.sectionPanel} ${active ? '' : styles.hidden}`}>
      <h2 className={styles.h2}>AI Video Analytics Estimator</h2>
      <div className={`${styles.row} ${styles.columns}`}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="aiCameraCount">Number of cameras</label>
          <input id="aiCameraCount" className={styles.formControl} type="number" step={1} min={1} value={cameraCount} onFocus={selectAllOnFocus} onChange={(e) => setCameraCount(parseInt(e.target.value, 10) || 1)} />
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
            <option value="ala-carte">Individual Pricing (pick individual analytics)</option>
            <option value="bundle">Bundle (recommended package, best savings)</option>
            {canEditPricing && (
              <option value="custom-bundle">Custom Bundle (sales-assembled, {CUSTOM_BUNDLE_DISCOUNT_PERCENT}% off, min {CUSTOM_BUNDLE_MIN_FEATURES} analytics)</option>
            )}
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="aiBillingCycle">Billing cycle</label>
          <select id="aiBillingCycle" className={styles.formControl} value={billingCycle} onChange={(e) => setBillingCycle(e.target.value as BillingCycle)}>
            <option value="yearly">Yearly (list price)</option>
            <option value="monthly">Monthly (annual rate ÷ 12)</option>
            <option value="onetime">One Time (Permanent License)</option>
          </select>
        </div>
      </div>

      {billingCycle === 'onetime' && (
        <div className={styles.domainPanel}>
          <div className={styles.field} style={{ marginBottom: 0 }}>
            <label className={styles.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={includeAmc} disabled={!canEditPricing} onChange={(e) => setIncludeAmc(e.target.checked)} />
              Include AMC (Annual Maintenance Contract) from Year 2
            </label>
          </div>
          {includeAmc && (
            <div className={`${styles.row} ${styles.columns}`} style={{ marginTop: 8 }}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="aiAmcPercent">AMC % per year (of license value)</label>
                <input
                  id="aiAmcPercent"
                  className={styles.formControl}
                  type="number"
                  step="any"
                  min={0}
                  max={100}
                  value={amcPercent}
                  disabled={!canEditPricing}
                  onFocus={selectAllOnFocus}
                  onChange={(e) => setAmcPercent(parseFloat(e.target.value) || 0)}
                />
                {!canEditPricing && <span className={styles.lockedHint}>Only a manager can change the AMC percentage.</span>}
              </div>
            </div>
          )}
          <p className={styles.small} style={{ marginTop: 6 }}>
            Permanent license — the analytics license is a one-time purchase priced at the current per-camera list rate; no further license fee is billed
            in later years. AMC covers ongoing support/updates from Year 2 onward.
          </p>
        </div>
      )}

      {pricingMode === 'bundle' && (
        <div className={styles.domainPanel}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="aiBundleSelect">Bundle package</label>
            <select id="aiBundleSelect" className={styles.formControl} value={bundleIndex} onChange={(e) => setBundleIndex(parseInt(e.target.value, 10))}>
              {effectiveBundles.map((b, i) => (
                <option key={b.name} value={i}>{b.name} — {b.includedFeatureNames.length || effectiveAnalytics.length} analytics</option>
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
              {' '}(Individual pricing value {formatMoney(selectedBundle.aLaCarteValue)}/cam/yr — save {selectedBundle.savingsPercent}%)
            </span>
          </div>
        </div>
      )}

      {pricingMode === 'custom-bundle' && (
        <div className={styles.domainPanel}>
          {!canEditPricing ? (
            <p className={styles.small}>Custom bundles can only be assembled by a manager or admin.</p>
          ) : (
            <>
              <p className={styles.small}>
                Pick at least {CUSTOM_BUNDLE_MIN_FEATURES} analytics below — they'll be combined into one bundle line at {CUSTOM_BUNDLE_DISCOUNT_PERCENT}% off
                their combined list price.
              </p>
              <div className={styles.lineItemRow}>
                <span style={{ flex: 1 }}>
                  Selected: <strong>{customBundleCount}</strong> analytics
                  {!customBundleQualifies && customBundleCount > 0 && (
                    <span style={{ color: '#b91c1c' }}> — need {CUSTOM_BUNDLE_MIN_FEATURES - customBundleCount} more to qualify for the bundle discount.</span>
                  )}
                  {customBundleCount === 0 && <span> — select analytics below to start the bundle.</span>}
                </span>
              </div>
            </>
          )}
        </div>
      )}

      <div className={`${styles.row} ${styles.columns}`}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="aiOneTimeCost">One-time implementation &amp; configuration cost (₹)</label>
          <input id="aiOneTimeCost" className={styles.formControl} type="number" step="any" min={0} value={oneTimeCost} onFocus={selectAllOnFocus} onChange={(e) => setOneTimeCost(parseFloat(e.target.value) || 0)} />
          <div className={styles.small} style={{ marginTop: 6 }}>
            Recommended for {AI_SLAB_LABELS[slabIndex]}: {formatMoney(recommendedSetupCost)}{' '}
            <button type="button" className={styles.secondaryButton} onClick={() => setOneTimeCost(recommendedSetupCost)}>
              Use this
            </button>
          </div>
        </div>
        {showFeaturePicker && (
          <div className={styles.field}>
            <label className={styles.label} htmlFor="aiCategoryJump">Jump to category</label>
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

      <div className={`${styles.row} ${styles.columns}`}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="aiInfraCostMode">Hardware / cloud infrastructure</label>
          <select id="aiInfraCostMode" className={styles.formControl} value={infraCostMode} onChange={(e) => setInfraCostMode(e.target.value as InfraCostMode)}>
            <option value="none">Not included in this quote</option>
            <option value="hardware">Hardware / on-site server (one-time cost)</option>
            <option value="cloud">Cloud / hosted server (monthly cost)</option>
            <option value="client">Client-provided (in client's scope — no cost)</option>
          </select>
        </div>
        {infraCostMode === 'hardware' && (
          <div className={styles.field}>
            <label className={styles.label} htmlFor="aiHardwareCost">Hardware cost, one-time (₹)</label>
            <input id="aiHardwareCost" className={styles.formControl} type="number" step="any" min={0} value={hardwareCost} onFocus={selectAllOnFocus} onChange={(e) => setHardwareCost(parseFloat(e.target.value) || 0)} />
          </div>
        )}
        {infraCostMode === 'cloud' && (
          <div className={styles.field}>
            <label className={styles.label} htmlFor="aiCloudCost">Cloud cost, per month (₹)</label>
            <input id="aiCloudCost" className={styles.formControl} type="number" step="any" min={0} value={cloudCost} onFocus={selectAllOnFocus} onChange={(e) => setCloudCost(parseFloat(e.target.value) || 0)} />
          </div>
        )}
        {infraCostMode === 'client' && (
          <div className={styles.field}>
            <div className={styles.small} style={{ paddingTop: 10 }}>Noted on the quote — no charge added.</div>
          </div>
        )}
      </div>

      <p className={styles.small}>
        List pricing, exclusive of 18% GST. Volume slab is based on the total camera count above. The Nanta VMS dashboard is included at no
        separate license cost — the one-time cost above covers integration, configuration, installation &amp; training only.
      </p>

      {showFeaturePicker && (
        <div className={styles.field}>
          <label className={styles.label}>Select analytics features</label>
          <div className={styles.aiFeatureList}>
            {(() => {
              let lastCategory: string | null = null;
              return effectiveAnalytics.map((feature, index) => {
                const showHeading = feature.category !== lastCategory;
                lastCategory = feature.category;
                const priceEditable = canEditPricing;
                const computedRate = feature.tiers[slabIndex] / billingDivisor;
                const currentRate = featureRate(feature, index);
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
                      {priceEditable ? (
                        <div className={styles.aiFeaturePrice} style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={(e) => e.preventDefault()}>
                          <input
                            type="number"
                            step="any"
                            min={0}
                            className={styles.formControl}
                            style={{ width: 100, textAlign: 'right' }}
                            value={currentRate}
                            onFocus={selectAllOnFocus}
                            onChange={(e) => {
                              const value = parseFloat(e.target.value);
                              setDetectionOverrides((prev) => {
                                const next = { ...prev };
                                if (Number.isNaN(value)) delete next[index];
                                else next[index] = value;
                                return next;
                              });
                            }}
                          />
                          <span>{periodUnitSuffix}</span>
                          {detectionOverrides[index] !== undefined && (
                            <button
                              type="button"
                              className={styles.secondaryButton}
                              onClick={() => setDetectionOverrides((prev) => { const next = { ...prev }; delete next[index]; return next; })}
                              title={`Reset to list price ${formatMoney(computedRate)}`}
                            >
                              Reset
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className={styles.aiFeaturePrice}>{formatMoney(currentRate)}{periodUnitSuffix}</div>
                      )}
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
