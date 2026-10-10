'use client';

import { createElement } from 'react';
import { ChevronRight } from 'lucide-react';
import { departmentIconFor } from '@/lib/icons';
import styles from './HealthGauge.module.css';

export interface HealthGaugeBreakdownRow {
  label: string;
  value: string;
}

export type HealthBand = 'red' | 'yellow' | 'green' | 'na';

export interface HealthGaugeProps {
  label: string;
  score: number;
  band: HealthBand;
  breakdown: HealthGaugeBreakdownRow[];
  managers?: { id: string; username?: string; name: string }[];
  /** Opens the full department detail. */
  onOpen: () => void;
}

export const BAND_COLOR: Record<HealthBand, string> = {
  red: 'var(--mx-danger, #dc2626)',
  yellow: 'var(--mx-warning, #d97706)',
  green: 'var(--mx-success, #16a34a)',
  na: 'var(--mx-ink-faint, #9ca3af)'
};

export const BAND_TEXT: Record<HealthBand, string> = {
  red: 'Needs attention',
  yellow: 'On track',
  green: 'Performing well',
  na: 'No data yet'
};

function RadialGauge({ score, band }: { score: number; band: HealthBand }) {
  const isNa = band === 'na';
  const clamped = Math.max(0, Math.min(100, score));
  const radius = 21;
  const strokeWidth = 3.5;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = isNa ? circumference : circumference - (clamped / 100) * circumference;
  const color = BAND_COLOR[band];

  return (
    <div className={styles.radialWrapper} aria-hidden="true">
      <svg className={styles.radialSvg} width="50" height="50" viewBox="0 0 50 50">
        {/* Background ring track */}
        <circle
          className={styles.radialTrack}
          cx="25"
          cy="25"
          r={radius}
          strokeWidth={strokeWidth}
        />
        {/* Progress Arc */}
        {!isNa && (
          <circle
            className={styles.radialFill}
            cx="25"
            cy="25"
            r={radius}
            strokeWidth={strokeWidth}
            stroke={color}
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            transform="rotate(-90 25 25)"
          />
        )}
      </svg>
      <div className={styles.radialCenter}>
        <span className={styles.radialScore} style={{ color: isNa ? 'var(--mx-ink-faint)' : color }}>
          {isNa ? '—' : `${score}%`}
        </span>
      </div>
    </div>
  );
}

export default function HealthGauge({ label, score, band, breakdown, managers = [], onOpen }: HealthGaugeProps) {
  const color = BAND_COLOR[band];
  const headline = breakdown[0];
  const deptIcon = departmentIconFor(label);
  const primaryManager = managers[0];

  return (
    <button
      type="button"
      className={`${styles.card} ${styles[`band_${band}`]}`}
      onClick={onOpen}
      aria-label={`${label} health: ${band === 'na' ? 'not enough data' : `${score} percent, ${BAND_TEXT[band]}`}. Click to open team breakdown.`}
    >
      <div className={styles.cardTop}>
        <div className={styles.deptHead}>
          <span className={styles.deptIcon}>
            {createElement(deptIcon, { size: 16 })}
          </span>
          <div className={styles.deptInfo}>
            <div className={styles.deptNameRow}>
              <span className={styles.deptName}>{label}</span>
              {managers.length > 1 && (
                <span className={styles.coLeadBadge} title={`${managers.length} co-leads`}>
                  +{managers.length - 1}
                </span>
              )}
            </div>
            <div className={styles.deptSub}>
              {primaryManager ? `Lead: ${primaryManager.name || primaryManager.username}` : 'Team Operations'}
            </div>
          </div>
        </div>

        <RadialGauge score={score} band={band} />
      </div>

      <div className={styles.cardMiddle}>
        <span className={styles.statusPill}>
          <span className={styles.statusDot} style={{ background: color }} aria-hidden="true" />
          <span>{BAND_TEXT[band]}</span>
        </span>

        {headline && (
          <div className={styles.metricItem}>
            <span className={styles.metricLabel}>{headline.label}:</span>
            <strong className={styles.metricValue}>{headline.value}</strong>
          </div>
        )}
      </div>

      <div className={styles.cardFooter}>
        <span className={styles.openText}>View breakdown</span>
        <ChevronRight size={13} className={styles.openChevron} />
      </div>
    </button>
  );
}
