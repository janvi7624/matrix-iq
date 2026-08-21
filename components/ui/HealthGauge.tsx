'use client';

import { useState } from 'react';
import styles from './HealthGauge.module.css';

export interface HealthGaugeBreakdownRow {
  label: string;
  value: string;
}

export interface HealthGaugeProps {
  label: string;
  score: number;
  band: 'red' | 'yellow' | 'green' | 'na';
  breakdown: HealthGaugeBreakdownRow[];
}

const BAND_COLOR: Record<HealthGaugeProps['band'], string> = {
  red: 'var(--mx-danger)',
  yellow: 'var(--mx-warning)',
  green: 'var(--mx-success)',
  na: 'var(--mx-ink-faint)'
};

const BAND_TEXT: Record<HealthGaugeProps['band'], string> = {
  red: 'Needs attention',
  yellow: 'On track',
  green: 'Performing well',
  na: 'Not enough data yet'
};

// Half-circle gauge: a full <circle>, clipped to its top half by the
// viewBox (the circle's center sits on the bottom edge), with a dash
// pattern of [halfCircumference, fullCircumference] so exactly one visible
// half draws as the "on" segment. rotate(180) shifts which half that is
// (top instead of the default bottom); the progress arc reuses the same
// setup and shortens its "on" segment via stroke-dashoffset to show score%
// of that half, growing left-to-right.
function Arc({ score, color }: { score: number; color: string }) {
  const radius = 40;
  const fullCircumference = 2 * Math.PI * radius;
  const halfCircumference = fullCircumference / 2;
  const clamped = Math.max(0, Math.min(100, score));
  const offset = halfCircumference * (1 - clamped / 100);

  return (
    <svg viewBox="0 0 100 58" className={styles.svg} aria-hidden="true">
      <circle
        cx="50"
        cy="50"
        r={radius}
        fill="none"
        stroke="var(--mx-border)"
        strokeWidth="10"
        strokeDasharray={`${halfCircumference} ${fullCircumference}`}
        transform="rotate(180 50 50)"
        strokeLinecap="round"
      />
      <circle
        cx="50"
        cy="50"
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth="10"
        strokeDasharray={`${halfCircumference} ${fullCircumference}`}
        strokeDashoffset={offset}
        transform="rotate(180 50 50)"
        strokeLinecap="round"
        className={styles.progressArc}
      />
    </svg>
  );
}

export default function HealthGauge({ label, score, band, breakdown }: HealthGaugeProps) {
  const [expanded, setExpanded] = useState(false);
  const color = BAND_COLOR[band];
  const canExpand = breakdown.length > 0;

  return (
    <div
      className={styles.tile}
      role={canExpand ? 'button' : undefined}
      tabIndex={canExpand ? 0 : undefined}
      onClick={() => canExpand && setExpanded((v) => !v)}
      onKeyDown={(e) => {
        if (canExpand && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          setExpanded((v) => !v);
        }
      }}
    >
      <Arc score={band === 'na' ? 0 : score} color={color} />
      <div className={styles.scoreLine} style={{ color }}>
        {band === 'na' ? '—' : `${score}%`}
      </div>
      <div className={styles.label}>{label}</div>
      <div className={styles.bandText} style={{ color }}>{BAND_TEXT[band]}</div>

      {expanded && (
        <div className={styles.breakdown} onClick={(e) => e.stopPropagation()}>
          {breakdown.map((row) => (
            <div key={row.label} className={styles.breakdownRow}>
              <span>{row.label}</span>
              <strong>{row.value}</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
