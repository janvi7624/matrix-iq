'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import StatusBadge, { StatusTone } from './ui/StatusBadge';
import SegmentedToggle from './ui/SegmentedToggle';
import { formatMoney } from '@/lib/format';
import styles from './myTarget.module.css';

type Scale = 'monthly' | 'quarterly' | 'annual';

const SCALE_OPTIONS: { value: Scale; label: string }[] = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'annual', label: 'Yearly' }
];

const STATUS_LABEL: Record<string, string> = {
  not_started: 'No Target Set',
  on_track: 'On Track',
  at_risk: 'At Risk',
  achieved: 'Achieved',
  exceeded: 'Exceeded'
};

interface PeriodProgress {
  periodType: Scale;
  displayPeriod: string;
  hasTarget: boolean;
  targetAmount: number;
  achievedAmount: number;
  achievementPercent: number;
  remainingAmount: number;
  status: string;
  daysTotal: number;
  daysLeft: number;
  expectedPercent: number;
  dealCount: number;
}

interface MyTargetPayload {
  hasAnyTarget: boolean;
  periods: Record<Scale, PeriodProgress>;
}

// The rep's own target on their own Dashboard — Monthly, Quarterly and
// Yearly off one fetch (all three scales come back together, so switching
// tabs is instant and the three can't disagree with each other).
//
// Renders NOTHING until the data says this viewer carries a target, so every
// non-sales role's dashboard is unchanged rather than gaining an empty
// "₹0 of ₹0" card.
export default function MyTargetPanel() {
  const [data, setData] = useState<MyTargetPayload | null>(null);
  const [scale, setScale] = useState<Scale>('monthly');

  useEffect(() => {
    let active = true;
    fetch('/api/targets/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => { if (active && body?.hasAnyTarget) setData(body); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  if (!data) return null;

  const p = data.periods[scale];
  const percent = Math.min(100, Math.max(0, p.achievementPercent));
  // Ahead/behind is the same comparison computeStatus makes, reused for the
  // bar's colour so the two can never contradict each other.
  const ahead = p.achievementPercent >= p.expectedPercent;
  const fillClass = !p.hasTarget ? '' : ahead ? styles.barFillAhead : styles.barFillBehind;

  return (
    <section className={styles.panel} aria-label="My sales target">
      <div className={styles.head}>
        <div>
          <span className={styles.title}>My Target</span>
          <span className={styles.period}>{p.displayPeriod}</span>
        </div>
        <SegmentedToggle options={SCALE_OPTIONS} value={scale} onChange={setScale} />
      </div>

      {!p.hasTarget ? (
        <div className={styles.empty}>
          No target set for {p.displayPeriod} yet. Your achievement so far this period is{' '}
          <b>{formatMoney(p.achievedAmount)}</b> across {p.dealCount} {p.dealCount === 1 ? 'deal' : 'deals'}.
        </div>
      ) : (
        <>
          <div className={styles.figures}>
            <span className={styles.achieved}>{formatMoney(p.achievedAmount)}</span>
            <span className={styles.ofTarget}>of {formatMoney(p.targetAmount)}</span>
            <StatusBadge
              tone={(p.status === 'achieved' ? 'won' : p.status) as StatusTone}
              label={STATUS_LABEL[p.status] || p.status}
            />
          </div>

          <div className={styles.barWrap}>
            <div className={`${styles.barFill} ${fillClass}`} style={{ width: `${percent}%` }} />
            {/* Where the calendar says you should be by today. */}
            <div className={styles.paceMark} style={{ left: `${Math.min(100, p.expectedPercent)}%` }} title={`Expected by today: ${p.expectedPercent}%`} />
          </div>

          <div className={styles.meta}>
            <span><b>{p.achievementPercent}%</b> achieved</span>
            <span>Pace to date <b>{p.expectedPercent}%</b></span>
            <span><b>{formatMoney(p.remainingAmount)}</b> to go</span>
            <span><b>{p.daysLeft}</b> of {p.daysTotal} days left</span>
            <span><b>{p.dealCount}</b> {p.dealCount === 1 ? 'deal' : 'deals'} counted</span>
            <Link href="/my-quotations">View my quotations →</Link>
          </div>
        </>
      )}
    </section>
  );
}
