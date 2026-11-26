'use client';

import { ReactNode } from 'react';
import StatCard, { StatCardTone } from './StatCard';
import styles from './statTile.module.css';

export type StatTone = 'default' | 'success' | 'danger' | 'warning' | 'info' | 'accent' | 'brand';

export interface StatTileProps {
  value: ReactNode;
  label: ReactNode;
  icon?: ReactNode;
  /** Default 'before' — icon renders in the card's icon tile; 'after' keeps it inline after the value. */
  iconPosition?: 'before' | 'after';
  tone?: StatTone;
  /** Presence of onClick renders a clickable card (with the open arrow); otherwise a static card. */
  onClick?: () => void;
  active?: boolean;
  ariaPressed?: boolean;
}

// Back-compat wrapper: existing call sites keep this API, rendering goes
// through the shared StatCard so every KPI tile in the app looks and
// behaves the same — neutral card, colour only on interaction and as a
// small tint on the icon tile.
export default function StatTile({ value, label, icon, iconPosition = 'before', tone = 'default', onClick, active, ariaPressed }: StatTileProps) {
  const inlineAfter = icon && iconPosition === 'after';
  return (
    <StatCard
      value={
        inlineAfter ? (
          <span className={styles.inlineValue}>
            {value}
            {icon}
          </span>
        ) : (
          value
        )
      }
      label={label}
      icon={inlineAfter ? undefined : icon}
      tone={tone as StatCardTone}
      className={styles.statTile}
      onClick={onClick}
      selected={onClick ? (ariaPressed ?? active) : undefined}
    />
  );
}
