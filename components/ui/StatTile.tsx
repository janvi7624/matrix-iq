'use client';

import { ReactNode } from 'react';
import calcStyles from '../calculator.module.css';
import styles from './statTile.module.css';

export type StatTone = 'default' | 'success' | 'danger' | 'warning' | 'info' | 'accent' | 'brand';

const TONE_CLASS: Record<Exclude<StatTone, 'default'>, string> = {
  success: styles.statSuccess,
  danger: styles.statDanger,
  warning: styles.statWarning,
  info: styles.statInfo,
  accent: styles.statAccent,
  brand: styles.statBrand
};

export interface StatTileProps {
  value: ReactNode;
  label: ReactNode;
  icon?: ReactNode;
  /** Default 'before' — icon renders ahead of the value. */
  iconPosition?: 'before' | 'after';
  tone?: StatTone;
  /** Presence of onClick renders a <button>; otherwise a plain <div>. */
  onClick?: () => void;
  active?: boolean;
  ariaPressed?: boolean;
}

// Panel chrome from calculator.module.css's .sectionPanel (same as before);
// layout/interactive/tone from statTile.module.css, moved verbatim from
// components/leadAssignment.module.css so nothing shifts visually.
export default function StatTile({ value, label, icon, iconPosition = 'before', tone = 'default', onClick, active, ariaPressed }: StatTileProps) {
  const valueClass = [styles.statValue, tone !== 'default' ? TONE_CLASS[tone] : ''].filter(Boolean).join(' ');
  const content = (
    <>
      <div className={valueClass}>
        {icon && iconPosition === 'before' && icon}
        {value}
        {icon && iconPosition === 'after' && icon}
      </div>
      <div className={calcStyles.small}>{label}</div>
    </>
  );

  if (onClick) {
    const classes = [calcStyles.sectionPanel, styles.statBtn, active ? styles.statActive : ''].filter(Boolean).join(' ');
    return (
      <button type="button" className={classes} onClick={onClick} aria-pressed={ariaPressed}>
        {content}
      </button>
    );
  }

  const classes = [calcStyles.sectionPanel, styles.statTile].filter(Boolean).join(' ');
  return <div className={classes}>{content}</div>;
}
