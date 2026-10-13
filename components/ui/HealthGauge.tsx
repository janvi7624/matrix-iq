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
  /** Who runs this department. First is treated as the primary lead;
      the rest only raise a co-lead count, since a tile has no room to
      name three people. Optional so a caller with no roster to hand
      still compiles. */
  managers?: { id: string; username?: string; name: string }[];
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

// Where the score changes meaning (scoreBand() in lib/departmentScoring.ts:
// red < 40, amber < 70, green >= 70) — a pair of tick marks on the track
// rather than three differently-hued zones. The dataviz skill's own meter
// spec is explicit: the fill carries severity, the unfilled track stays flat
// neutral, never a multi-hue zone map — and separately, this app's
// --mx-danger/--mx-warning pair fails its own colorblind-separation check
// (validated: ΔE 9.1, below the 15 floor even for normal vision), so a
// tinted track was always a legibility risk a plain tick sidesteps entirely.
// The band is still fully legible without color: the score number, the fill
// color, and the page-level legend above the grid (which spells out
// "Below 40" / "40–69" / "70+" in plain text) all carry it too.
const THRESHOLD_TICKS = [40, 70];

export default function HealthGauge({ label, score, band, breakdown, managers = [], onOpen }: HealthGaugeProps) {
  const color = BAND_COLOR[band];
  const isNa = band === 'na';
  const clamped = Math.max(0, Math.min(100, score));
  const headline = breakdown[0];
  const primaryManager = managers[0];

  return (
    <button type="button" className={styles.tile} onClick={onOpen} aria-label={`${label} health: ${isNa ? 'not enough data' : `${score} percent, ${BAND_TEXT[band]}`}. Open full details.`}>
      <div className={styles.topRow}>
        <span className={styles.label}>{label}</span>
        <span className={styles.bandDot} style={{ background: color }} aria-hidden="true" />
      </div>

      {/* Who to talk to about this score. Carried over from the card this
          tile replaced — the number is only actionable if you know whose
          it is. Absent rather than "Unassigned" when nobody is set, so a
          department with no lead does not shout about it on a dashboard. */}
      {primaryManager && (
        <div className={styles.deptLead}>
          Lead: {primaryManager.name || primaryManager.username}
          {managers.length > 1 && (
            <span className={styles.coLeadBadge} title={managers.length + ' co-leads'}>+{managers.length - 1}</span>
          )}
        </div>
      )}

      <div className={styles.scoreLine} style={{ color }}>{isNa ? '—' : `${score}%`}</div>

      {/* A ratio against a fixed limit reads faster as a straight meter than
          as a dial — the semicircular arc this replaced was more decorative
          than legible at this tile size. */}
      <div className={styles.meterTrack}>
        {!isNa && <div className={styles.meterFill} style={{ width: `${clamped}%`, background: color }} />}
        {!isNa &&
          THRESHOLD_TICKS.map((pct) => (
            <span key={pct} className={styles.tick} style={{ left: `${pct}%` }} aria-hidden="true" />
          ))}
      </div>

      {/* One headline metric on the face of the tile — the old version hid all
          of this behind a click, so a gauge grid was a wall of bare percentages. */}
      <div className={styles.headlineMetric}>
        {headline ? (
          <>
            {headline.label} <strong>{headline.value}</strong>
          </>
        ) : (
          BAND_TEXT[band]
        )}
      </div>

      <span className={styles.openHint}>
        <Users size={12} /> Team detail <ChevronRight size={13} />
      </span>
    </button>
  );
}
