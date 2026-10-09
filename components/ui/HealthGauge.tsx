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

// Same left-to-right mapping as segmentProps, but as an actual (x, y) point
// on the arc's centerline instead of a dash length — for the threshold ticks,
// which need a real coordinate to draw a short radial line at, not a stroke
// segment. pct=0 is the arc's left end, pct=100 its right end, matching the
// rotated circle's own traversal exactly (verified against segmentProps:
// pct=0 -> (cx-r, cy), pct=100 -> (cx+r, cy), both on the baseline).
function radialPoint(pct: number, r: number, cx = 50, cy = 50) {
  const theta = Math.PI * (1 - pct / 100);
  return { x: cx + r * Math.cos(theta), y: cy - r * Math.sin(theta) };
}

// Where the score changes meaning (scoreBand() in lib/departmentScoring.ts:
// red < 40, amber < 70, green >= 70) — now a pair of tick marks on the track
// rather than three differently-hued track segments. The dataviz skill's own
// meter spec is explicit: the fill carries severity, the unfilled track is a
// flat neutral, never a multi-hue zone map — and separately, this app's
// --mx-danger/--mx-warning pair fails its colorblind-separation check
// (validated: ΔE 9.1, below the 15 floor even for normal vision), so a
// three-colour track was always a legibility risk a plain tick mark sidesteps
// entirely. The band is still fully legible without color: the score number,
// the fill color AND the text label (BAND_TEXT) all carry it too.
const THRESHOLD_TICKS = [40, 70];

function Arc({ score, band }: { score: number; band: HealthBand }) {
  const clamped = Math.max(0, Math.min(100, score));
  const isNa = band === 'na';

  return (
    <svg viewBox="0 0 100 58" className={styles.svg} aria-hidden="true">
      <circle
        cx="50"
        cy="50"
        r={RADIUS}
        fill="none"
        stroke="var(--mx-border)"
        strokeWidth="10"
        strokeLinecap="round"
        transform="rotate(180 50 50)"
        {...segmentProps(0.8, 99.2)}
      />

      {!isNa &&
        THRESHOLD_TICKS.map((pct) => {
          const inner = radialPoint(pct, RADIUS - 6);
          const outer = radialPoint(pct, RADIUS + 7);
          return (
            <line
              key={pct}
              x1={inner.x}
              y1={inner.y}
              x2={outer.x}
              y2={outer.y}
              stroke="var(--mx-surface)"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          );
        })}

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
