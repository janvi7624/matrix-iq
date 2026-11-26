'use client';

import Link from '@/components/ui/AppLink';
import { CSSProperties, KeyboardEvent, ReactNode, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import styles from './statCard.module.css';

export type StatCardTone = 'default' | 'danger' | 'warning' | 'success' | 'info' | 'accent' | 'brand';

export interface StatCardProps {
  value: ReactNode;
  label: ReactNode;
  /** Optional third line (e.g. "₹2.4L this month"). */
  sub?: ReactNode;
  /** Optional leading icon shown in a tinted square before the value. */
  icon?: ReactNode;
  tone?: StatCardTone;
  /** Makes the card a <button> with the open affordance. */
  onClick?: () => void;
  /** Makes the card a link with the open affordance. */
  href?: string;
  /** Plain <a> instead of next/link (downloads, external). */
  native?: boolean;
  /** Filter-card state: sets aria-pressed and the selected look. */
  selected?: boolean;
  disabled?: boolean;
  /** Accessible hint appended to the card's name, e.g. "View active projects". Defaults to "View details". */
  actionLabel?: string;
  /** Replace the default → affordance icon. */
  actionIcon?: ReactNode;
  /** Word shown beside the arrow on hover (default "View"). */
  actionText?: string;
  /** Extra content under the label (a progress bar, a mini breakdown…). */
  children?: ReactNode;
  size?: 'md' | 'compact';
  /** 'sm' for text values (a name, a department) — the default large size is meant for numbers. */
  valueSize?: 'lg' | 'sm';
  align?: 'left' | 'center';
  className?: string;
  style?: CSSProperties;
  title?: string;
  id?: string;
}

export function statCardClassName({
  tone = 'default',
  interactive = false,
  selected = false,
  disabled = false,
  size = 'md',
  align = 'left',
  className
}: {
  tone?: StatCardTone;
  interactive?: boolean;
  selected?: boolean;
  disabled?: boolean;
  size?: 'md' | 'compact';
  align?: 'left' | 'center';
  className?: string;
}): string {
  return [
    styles.card,
    tone !== 'default' ? styles[tone] : '',
    interactive ? styles.interactive : '',
    selected ? styles.selected : '',
    disabled ? styles.disabled : '',
    size === 'compact' ? styles.compact : '',
    align === 'center' ? styles.center : '',
    className || ''
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * The one KPI / summary / count card.
 *
 * Static (no onClick/href) → a flat card.
 * Interactive (onClick or href) → a button/link with a visible open
 * affordance (→, top-right), hover lift + accent line, focus ring,
 * and `selected` for cards that act as filters.
 */
export default function StatCard({
  value,
  label,
  sub,
  icon,
  tone = 'default',
  onClick,
  href,
  native,
  selected,
  disabled,
  actionLabel = 'View details',
  actionIcon,
  actionText = 'View',
  children,
  size = 'md',
  valueSize = 'lg',
  align = 'left',
  className,
  style,
  title,
  id
}: StatCardProps) {
  const interactive = Boolean(onClick || href) && !disabled;
  const classes = statCardClassName({ tone, interactive, selected, disabled, size, align, className });

  const opens = Boolean(onClick || href);
  // Bumped on every press: re-keys the "View →" pill so its press animation
  // (bounce + ripple ring) replays on each click, even rapid ones.
  const [pressCount, setPressCount] = useState(0);
  const press = interactive ? () => setPressCount((n) => n + 1) : undefined;
  const pressKeys = interactive
    ? (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') setPressCount((n) => n + 1);
      }
    : undefined;
  const body = (
    <>
      {(icon || opens) && (
        <span className={styles.head}>
          {icon ? (
            <span className={styles.icon} aria-hidden="true">
              {icon}
            </span>
          ) : (
            <span />
          )}
          {opens && (
            <span key={pressCount} className={pressCount ? `${styles.affordance} ${styles.affordancePressed}` : styles.affordance} aria-hidden="true">
              <span className={styles.affordanceText}>{actionText}</span>
              <span className={styles.affordanceIcon}>{actionIcon ?? <ArrowRight />}</span>
            </span>
          )}
        </span>
      )}
      <span className={valueSize === 'sm' ? `${styles.value} ${styles.valueSm}` : styles.value}>{value}</span>
      <span className={styles.label}>{label}</span>
      {sub !== undefined && sub !== null && <span className={styles.sub}>{sub}</span>}
      {children && <span className={styles.extra}>{children}</span>}
      {opens && <span className="mx-sr-only"> — {actionLabel}</span>}
    </>
  );


  if (href && !disabled) {
    if (native) {
      return (
        <a href={href} className={classes} style={style} title={title} id={id} onPointerDown={press} onKeyDown={pressKeys}>
          {body}
        </a>
      );
    }
    return (
      <Link href={href} className={classes} style={style} title={title} id={id} onPointerDown={press} onKeyDown={pressKeys}>
        {body}
      </Link>
    );
  }

  if (onClick || (href && disabled)) {
    return (
      <button
        type="button"
        className={classes}
        style={style}
        title={title}
        id={id}
        onClick={onClick}
        onPointerDown={press}
        onKeyDown={pressKeys}
        disabled={disabled}
        aria-pressed={selected === undefined ? undefined : selected}
      >
        {body}
      </button>
    );
  }

  return (
    <div className={classes} style={style} title={title} id={id}>
      {body}
    </div>
  );
}

/** Responsive grid for a row of StatCards. `minWidth` sets the smallest card width (default 160px). */
export function StatCardGrid({ children, minWidth, className, style }: { children: ReactNode; minWidth?: number; className?: string; style?: CSSProperties }) {
  return (
    <div
      className={[styles.grid, className || ''].filter(Boolean).join(' ')}
      style={{ ...(minWidth ? ({ '--stat-card-min': `${minWidth}px` } as CSSProperties) : null), ...style }}
    >
      {children}
    </div>
  );
}
