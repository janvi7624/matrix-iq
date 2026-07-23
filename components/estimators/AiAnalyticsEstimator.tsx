'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AI_SLAB_LABELS, aiAnalytics, getAiSlabIndex } from '@/lib/data/aiAnalytics';
import { formatMoney, slugify } from '@/lib/format';
import { DomainResult, LineItem } from '@/lib/types';
import styles from '../calculator.module.css';

interface AiAnalyticsEstimatorProps {
  active: boolean;
  onResultChange: (result: DomainResult) => void;
}

export default function AiAnalyticsEstimator({ active, onResultChange }: AiAnalyticsEstimatorProps) {
  const [cameraCount, setCameraCount] = useState(25);
  const [oneTimeCost, setOneTimeCost] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [categoryJump, setCategoryJump] = useState('');
  const categoryRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const effectiveCameraCount = Math.max(1, Math.round(cameraCount) || 1);
  const slabIndex = getAiSlabIndex(effectiveCameraCount);

  const categories = useMemo(() => {
    const seen: string[] = [];
    aiAnalytics.forEach((f) => {
      if (!seen.includes(f.category)) seen.push(f.category);
    });
    return seen;
  }, []);

  const result = useMemo<DomainResult | null>(() => {
    let analyticsSubtotal = 0;
    const lineItems: LineItem[] = [];
    aiAnalytics.forEach((feature, index) => {
      if (!selected.has(index)) return;
      const rate = feature.tiers[slabIndex];
      const amount = rate * effectiveCameraCount;
      analyticsSubtotal += amount;
      lineItems.push({ description: `${feature.name} (${feature.category})`, qty: effectiveCameraCount, rate, amount, unit: 'License' });
    });
    const oneTime = Number(oneTimeCost) || 0;
    if (oneTime) lineItems.push({ description: 'One-time implementation & configuration', qty: 1, rate: oneTime, amount: oneTime, unit: 'Nos' });

    const summary = [
      { label: 'Cameras', value: String(effectiveCameraCount) },
      { label: 'Volume slab', value: AI_SLAB_LABELS[slabIndex] },
      { label: 'Analytics selected', value: String(selected.size) },
      { label: 'Analytics subtotal (per year)', value: formatMoney(analyticsSubtotal) },
      ...(oneTime ? [{ label: 'One-time implementation cost', value: formatMoney(oneTime) }] : [])
    ];

    return { label: `AI Video Analytics — ${effectiveCameraCount} cameras`, domainKey: 'ai', lineItems, subtotal: analyticsSubtotal + oneTime, summary };
  }, [selected, slabIndex, effectiveCameraCount, oneTimeCost]);

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
          <label className={styles.label} htmlFor="aiOneTimeCost">One-time implementation &amp; configuration cost (₹)</label>
          <input id="aiOneTimeCost" className={styles.formControl} type="number" step="any" min={0} value={oneTimeCost} onChange={(e) => setOneTimeCost(parseFloat(e.target.value) || 0)} />
        </div>
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
      </div>
      <p className={styles.small}>Per-license / per-year list pricing, exclusive of 18% GST. Volume slab is based on the total camera count above. Select the analytics features required for this project.</p>
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
                    <div className={styles.aiFeaturePrice}>{formatMoney(feature.tiers[slabIndex])}/license/yr</div>
                  </label>
                </div>
              );
            });
          })()}
        </div>
      </div>
    </section>
  );
}
