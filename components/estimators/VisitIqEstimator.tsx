'use client';

import { useEffect, useMemo, useState } from 'react';
import { visitIqAddOns, visitIqPlans, VisitIqAddOn, VisitIqPlan } from '@/lib/data/visitiq';
import { formatMoney } from '@/lib/format';
import { selectAllOnFocus } from '@/lib/numberInputHelpers';
import { DomainResult, LineItem } from '@/lib/types';
import { applyOverride, extraProductKeys, overrideMapKey, OverrideMap } from '@/lib/catalogOverrides';
import styles from '../calculator.module.css';

interface VisitIqEstimatorProps {
  active: boolean;
  onResultChange: (result: DomainResult) => void;
  overrides: OverrideMap;
}

type BillingCycle = 'monthly' | 'yearly';

function formatLimit(value: number | null): string {
  if (value === null) return 'Unlimited';
  return String(value);
}

export default function VisitIqEstimator({ active, onResultChange, overrides }: VisitIqEstimatorProps) {
  const [planId, setPlanId] = useState('business');
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('yearly');
  const [extraRobots, setExtraRobots] = useState(0);
  const [extraKiosks, setExtraKiosks] = useState(0);
  const [extraEmployeeBlocks, setExtraEmployeeBlocks] = useState(0);
  const [addOnFlags, setAddOnFlags] = useState<Record<string, boolean>>({});

  // Admin-added plans/add-ons (Product Catalog) have no entry in the
  // hardcoded visitIqPlans/visitIqAddOns arrays — append a synthetic entry
  // built entirely from the override's `fields` (the complete record for a
  // brand-new product, not a partial patch).
  const effectivePlans = useMemo(() => {
    const base = visitIqPlans.map((p) => applyOverride(p, overrides.get(overrideMapKey('visitiq-plan', p.id)), 'name'));
    const extraIds = extraProductKeys('visitiq-plan', visitIqPlans.map((p) => p.id), overrides);
    const extra = extraIds.map((id) => applyOverride({ id } as VisitIqPlan, overrides.get(overrideMapKey('visitiq-plan', id)), 'name'));
    return [...base, ...extra];
  }, [overrides]);
  const effectiveAddOns = useMemo(() => {
    const base = visitIqAddOns.map((a) => applyOverride(a, overrides.get(overrideMapKey('visitiq-addon', a.key)), 'label'));
    const extraKeys = extraProductKeys('visitiq-addon', visitIqAddOns.map((a) => a.key), overrides);
    const extra = extraKeys.map((key) => applyOverride({ key } as VisitIqAddOn, overrides.get(overrideMapKey('visitiq-addon', key)), 'label'));
    return [...base, ...extra];
  }, [overrides]);

  const plan = useMemo(() => effectivePlans.find((p) => p.id === planId) || effectivePlans[0], [planId, effectivePlans]);
  const periodUnit = billingCycle === 'yearly' ? 'Year' : 'Month';
  const cycleMultiplier = billingCycle === 'yearly' ? 12 : 1;

  const result = useMemo<DomainResult | null>(() => {
    const lineItems: LineItem[] = [];
    let subtotal = 0;

    const baseAmount = billingCycle === 'yearly' ? plan.annualTotal : plan.monthlyPrice;
    lineItems.push({
      description: `VisitIQ ${plan.name} plan (${plan.subtitle}) — ${formatLimit(plan.robots)} robots, ${formatLimit(plan.kiosks)} kiosks, up to ${formatLimit(plan.employees)} employees`,
      qty: 1,
      rate: baseAmount,
      amount: baseAmount,
      unit: periodUnit
    });
    subtotal += baseAmount;

    const qtyAddOns: { key: string; qty: number }[] = [
      { key: 'extraRobot', qty: extraRobots },
      { key: 'extraKiosk', qty: extraKiosks },
      { key: 'extraEmployees25', qty: extraEmployeeBlocks }
    ];
    qtyAddOns.forEach(({ key, qty }) => {
      if (qty <= 0) return;
      const addOn = effectiveAddOns.find((a) => a.key === key);
      if (!addOn || addOn.monthlyPrice == null) return;
      const rate = addOn.monthlyPrice * cycleMultiplier;
      const amount = rate * qty;
      subtotal += amount;
      lineItems.push({ description: addOn.label, qty, rate, amount, unit: periodUnit });
    });

    ['receptionistModule', 'whiteLabel', 'dedicatedServer'].forEach((key) => {
      if (!addOnFlags[key]) return;
      const addOn = effectiveAddOns.find((a) => a.key === key);
      if (!addOn || addOn.monthlyPrice == null) return;
      const rate = addOn.monthlyPrice * cycleMultiplier;
      subtotal += rate;
      lineItems.push({ description: addOn.label, qty: 1, rate, amount: rate, unit: periodUnit });
    });

    if (addOnFlags.oneTimeSetup) {
      const setup = effectiveAddOns.find((a) => a.key === 'oneTimeSetup');
      const amount = setup?.monthlyPrice || 0;
      subtotal += amount;
      lineItems.push({ description: 'One-Time Setup', qty: 1, rate: amount, amount, unit: 'Nos' });
    }

    if (addOnFlags.customIntegration) {
      lineItems.push({ description: 'Custom Integration — price varies by scope, quote separately', qty: 1, rate: 0, amount: 0, unit: 'Note' });
    }

    const summary = [
      { label: 'Plan', value: `${plan.name} (${plan.subtitle})` },
      { label: 'Billing cycle', value: billingCycle === 'yearly' ? 'Annual (save ~17%)' : 'Monthly' },
      { label: 'Subtotal', value: formatMoney(subtotal) }
    ];

    return { label: `VisitIQ VMS — ${plan.name} plan`, domainKey: 'visitiq', lineItems, subtotal, summary };
  }, [plan, billingCycle, periodUnit, cycleMultiplier, extraRobots, extraKiosks, extraEmployeeBlocks, addOnFlags, effectiveAddOns]);

  useEffect(() => {
    if (active && result) onResultChange(result);
  }, [active, result, onResultChange]);

  const toggleAddOn = (key: string) => setAddOnFlags((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <section className={`${styles.sectionPanel} ${active ? '' : styles.hidden}`}>
      <h2 className={styles.h2}>VisitIQ VMS Estimator</h2>
      <p className={styles.small}>Visitor management system — kiosk check-in, robot escort, and receptionist dashboard. Pricing per site/location.</p>

      <div className={`${styles.row} ${styles.columns}`}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="visitiqPlan">Plan</label>
          <select id="visitiqPlan" className={styles.formControl} value={planId} onChange={(e) => setPlanId(e.target.value)}>
            {effectivePlans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.subtitle}){p.badge ? ` — ${p.badge}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="visitiqBilling">Billing cycle</label>
          <select id="visitiqBilling" className={styles.formControl} value={billingCycle} onChange={(e) => setBillingCycle(e.target.value as BillingCycle)}>
            <option value="yearly">Annual — {formatMoney(plan.annualPricePerMonth)}/mo billed yearly (save ~17%)</option>
            <option value="monthly">Monthly — {formatMoney(plan.monthlyPrice)}/mo</option>
          </select>
        </div>
      </div>

      <div className={styles.domainPanel}>
        <p className={styles.small}>{plan.description}</p>
        <div className={`${styles.row} ${styles.columns}`}>
          <div className={styles.small}>Robots included: <strong>{formatLimit(plan.robots)}</strong></div>
          <div className={styles.small}>Kiosks included: <strong>{formatLimit(plan.kiosks)}</strong></div>
          <div className={styles.small}>Employees: <strong>{formatLimit(plan.employees)}</strong></div>
          <div className={styles.small}>Admins: <strong>{plan.admins}</strong></div>
        </div>
        <p className={styles.small} style={{ marginTop: 8 }}>Includes: {plan.features.join(', ')}</p>
      </div>

      <h3 className={styles.h2} style={{ fontSize: '1rem', marginTop: 18 }}>Add-ons</h3>
      <div className={`${styles.row} ${styles.columns}`}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="visitiqExtraRobots">Extra Temi robots ({formatMoney(1599)}/mo each)</label>
          <input id="visitiqExtraRobots" className={styles.formControl} type="number" step={1} min={0} value={extraRobots} onFocus={selectAllOnFocus} onChange={(e) => setExtraRobots(Math.max(0, parseInt(e.target.value, 10) || 0))} />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="visitiqExtraKiosks">Extra kiosk screens ({formatMoney(699)}/mo each)</label>
          <input id="visitiqExtraKiosks" className={styles.formControl} type="number" step={1} min={0} value={extraKiosks} onFocus={selectAllOnFocus} onChange={(e) => setExtraKiosks(Math.max(0, parseInt(e.target.value, 10) || 0))} />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="visitiqExtraEmployees">Extra employee blocks of 25 ({formatMoney(299)}/mo each)</label>
          <input id="visitiqExtraEmployees" className={styles.formControl} type="number" step={1} min={0} value={extraEmployeeBlocks} onFocus={selectAllOnFocus} onChange={(e) => setExtraEmployeeBlocks(Math.max(0, parseInt(e.target.value, 10) || 0))} />
        </div>
      </div>

      <div className={styles.field}>
        {effectiveAddOns
          .filter((a) => !['extraRobot', 'extraKiosk', 'extraEmployees25'].includes(a.key))
          .map((addOn) => (
            <label key={addOn.key} className={styles.aiFeatureItem}>
              <input type="checkbox" className={styles.aiFeatureCheckbox} checked={Boolean(addOnFlags[addOn.key])} onChange={() => toggleAddOn(addOn.key)} />
              <div className={styles.aiFeatureInfo}>
                <div className={styles.aiFeatureName}>{addOn.label}</div>
              </div>
              <div className={styles.aiFeaturePrice}>
                {addOn.monthlyPrice == null
                  ? 'Depends on integration — quote separately'
                  : addOn.oneTime
                    ? `${formatMoney(addOn.monthlyPrice)} one-time`
                    : `${formatMoney(addOn.monthlyPrice * cycleMultiplier)}/${periodUnit.toLowerCase()}`}
              </div>
            </label>
          ))}
      </div>
    </section>
  );
}
