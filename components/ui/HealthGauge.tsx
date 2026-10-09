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
  /** Opens the full department detail. */
  onOpen: () => void;
}

// Also imported by components/DepartmentHealthDetail.tsx and
// components/TmsProjectDetailView.tsx — a band colour has to mean the same
// thing everywhere it appears, so it is defined once.
export const BAND_COLOR: Record<HealthBand, string> = {
  red: 'var(--mx-danger)',
  yellow: 'var(--mx-warning)',
  green: 'var(--mx-success)',
  na: 'var(--mx-ink-faint)'
};

export const BAND_TEXT: Record<HealthBand, string> = {
  red: 'Needs attention',
  yellow: 'On track',
  green: 'Performing well',
  na: 'Not enough data yet'
};

// Mirrors scoreBand() in lib/departmentScoring.ts (green >= 70, yellow >= 40).
// The scoring rules themselves are untouched — this only draws them.
const THRESHOLDS = [40, 70];

// This was a semicircular gauge. A half-circle shows ONE value against a
// target well, but this grid exists to answer "which department needs me?",
// and comparing a dozen arc angles across a dozen tiles is far harder than
// comparing a dozen bars that all start at the same left edge on the same
// scale. The zones, the score and the thresholds are unchanged; only the
// geometry is now one a reader can compare across cards at a glance.
function ProgressTrack({ score, band }: { score: number; band: HealthBand }) {
  const clamped = Math.max(0, Math.min(100, score));
  const isNa = band === 'na';

  return (
    <div className={styles.track} aria-hidden="true">
      {!isNa && <div className={styles.fill} style={{ width: `${clamped}%`, background: BAND_COLOR[band] }} />}
      {/* The 40 and 70 marks, so a reader can see which side of a threshold
          a score falls on without remembering the scale. Drawn in the track
          colour, so they separate with a gap rather than adding ink. */}
      {!isNa && THRESHOLDS.map((value) => (
        <span key={value} className={styles.threshold} style={{ left: `${value}%` }} />
      ))}
    </div>
  );
}

export default function HealthGauge({ label, score, band, breakdown, onOpen }: HealthGaugeProps) {
  const color = BAND_COLOR[band];
  const headline = breakdown[0];
  // createElement rather than assigning to a capitalised local and writing
  // <DeptIcon />: the react-hooks lint rule reads that pattern as declaring
  // a component during render, which would reset its state on every pass.
  const deptIcon = departmentIconFor(label);

  return (
    <button
      type="button"
      className={`${styles.card} ${styles[`band_${band}`]}`}
      onClick={onOpen}
      aria-label={`${label} health: ${band === 'na' ? 'not enough data' : `${score} percent, ${BAND_TEXT[band]}`}. Open team details.`}
    >
      <div className={styles.topRow}>
        <span className={styles.deptIcon}>{createElement(deptIcon, { size: 15 })}</span>
        <span className={styles.deptName}>{label}</span>
        <span className={styles.score} style={{ color }}>{band === 'na' ? '—' : `${score}%`}</span>
      </div>

      <ProgressTrack score={score} band={band} />

      <div className={styles.statusRow}>
        <span className={styles.statusDot} style={{ background: color }} aria-hidden="true" />
        <span className={styles.statusText} style={{ color }}>{BAND_TEXT[band]}</span>
      </div>

      {/* One real metric on the face of the card — without it a grid of
          scores is a wall of percentages with every reason hidden behind a
          click. Comes straight from the department's own breakdown; nothing
          is computed here. */}
      <div className={styles.metricRow}>
        {headline ? (
          <>
            <span className={styles.metricLabel}>{headline.label}</span>
            <strong className={styles.metricValue}>{headline.value}</strong>
          </>
        ) : (
          <span className={styles.metricLabel}>No metrics recorded yet</span>
        )}
      </div>

      <span className={styles.openHint}>
        View team details <ChevronRight size={13} className={styles.openChevron} />
      </span>
    </button>
  );
}
