'use client';

import { ChevronRight, Users } from 'lucide-react';
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
// Rendering the thresholds as coloured zones in the gauge track is the point of
// this component: a bare "58%" tells you nothing on its own, but 58% sitting
// visibly inside the amber band between the 40 and 70 marks is immediately
// readable without needing to remember the scale.
const ZONES: { from: number; to: number; band: Exclude<HealthBand, 'na'> }[] = [
  { from: 0, to: 40, band: 'red' },
  { from: 40, to: 70, band: 'yellow' },
  { from: 70, to: 100, band: 'green' }
];

const RADIUS = 40;
const FULL_C = 2 * Math.PI * RADIUS;
const HALF_C = FULL_C / 2;

// A full <circle> whose centre sits on the bottom edge of the viewBox, so only
// its top half is visible. rotate(180 50 50) puts that visible half at path
// offset 0..HALF_C running left-to-right, so a percentage maps directly onto
// arc length.
//
// A dash pattern of [segmentLength, FULL_C] draws exactly one visible segment;
// shifting stroke-dashoffset slides it to begin `from`% along the arc. The
// obvious shift is a negative offset (-start), but negative stroke-dashoffset
// was an error in SVG 1.1 and is only well-defined from SVG 2 on. Since the
// pattern is periodic with period (segmentLength + FULL_C), adding one whole
// period gives an identical rendering with a strictly positive value.
function segmentProps(from: number, to: number) {
  const length = (HALF_C * (to - from)) / 100;
  const start = (HALF_C * from) / 100;
  // A segment starting at 0 needs no shift at all. Keeping the offset a literal
  // 0 here matters for the score arc: it's the only animated segment, and if
  // its offset also changed with `length` the CSS transition on
  // stroke-dasharray would be fighting an untransitioned offset jump.
  if (start === 0) return { strokeDasharray: `${length} ${FULL_C}`, strokeDashoffset: 0 };
  return { strokeDasharray: `${length} ${FULL_C}`, strokeDashoffset: length + FULL_C - start };
}

function Arc({ score, band }: { score: number; band: HealthBand }) {
  const clamped = Math.max(0, Math.min(100, score));
  const isNa = band === 'na';

  return (
    <svg viewBox="0 0 100 58" className={styles.svg} aria-hidden="true">
      {/* Threshold zones — always drawn, tinted back so the live score arc on
          top stays the dominant mark. A 1.2pt gap keeps them visually distinct. */}
      {ZONES.map((z) => (
        <circle
          key={z.band}
          cx="50"
          cy="50"
          r={RADIUS}
          fill="none"
          stroke={isNa ? 'var(--mx-border)' : BAND_COLOR[z.band]}
          strokeOpacity={isNa ? 1 : 0.18}
          strokeWidth="10"
          strokeLinecap="butt"
          transform="rotate(180 50 50)"
          {...segmentProps(z.from, Math.max(z.from, z.to - 1.2))}
        />
      ))}

      {/* The score itself. */}
      {!isNa && (
        <circle
          cx="50"
          cy="50"
          r={RADIUS}
          fill="none"
          stroke={BAND_COLOR[band]}
          strokeWidth="10"
          strokeLinecap="round"
          transform="rotate(180 50 50)"
          className={styles.progressArc}
          {...segmentProps(0, clamped)}
        />
      )}
    </svg>
  );
}

export default function HealthGauge({ label, score, band, breakdown, onOpen }: HealthGaugeProps) {
  const color = BAND_COLOR[band];
  const headline = breakdown[0];

  return (
    <button type="button" className={styles.tile} onClick={onOpen} aria-label={`${label} health: ${band === 'na' ? 'not enough data' : `${score} percent, ${BAND_TEXT[band]}`}. Open full details.`}>
      <div className={styles.gaugeWrap}>
        <Arc score={score} band={band} />
        <div className={styles.gaugeCenter}>
          <div className={styles.scoreLine} style={{ color }}>{band === 'na' ? '—' : `${score}%`}</div>
        </div>
      </div>

      <div className={styles.label}>{label}</div>
      <div className={styles.bandRow}>
        <span className={styles.bandDot} style={{ background: color }} aria-hidden="true" />
        <span className={styles.bandText} style={{ color }}>{BAND_TEXT[band]}</span>
      </div>

      {/* One headline number on the face of the tile — the old version hid all
          of this behind a click, so a gauge grid was a wall of bare percentages. */}
      {headline && (
        <div className={styles.headlineMetric}>
          <span className={styles.headlineLabel}>{headline.label}</span>
          <strong>{headline.value}</strong>
        </div>
      )}

      <span className={styles.openHint}>
        <Users size={12} /> Team detail <ChevronRight size={13} />
      </span>
    </button>
  );
}
