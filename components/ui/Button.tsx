'use client';

import { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from '../quotationHistory.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'success' | 'ghost';

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: styles.actionBtnPrimary,
  secondary: styles.actionBtnSecondary,
  danger: styles.actionBtnDanger,
  success: styles.actionBtnSuccess,
  ghost: styles.actionBtnGhost
};

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: ButtonVariant;
  compact?: boolean;
  icon?: ReactNode;
  loading?: boolean;
  loadingLabel?: string;
  children: ReactNode;
}

// The one button call sites should reach for going forward — wraps the
// existing .actionBtn family in quotationHistory.module.css (icon slot,
// hover/active/disabled states, and the 560px mobile stacking it already
// has) rather than introducing a second CSS system. min-height: 44px lives
// on .actionBtn itself, so every variant meets the touch-target minimum
// automatically; `compact` opts out for dense inline row actions where a
// full 44px target would be excessive (e.g. a table row's "Edit" button).
export default function Button({
  variant = 'secondary',
  compact = false,
  icon,
  loading = false,
  loadingLabel,
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  const classes = [styles.actionBtn, VARIANT_CLASS[variant], compact ? styles.actionBtnCompact : '', className || ''].filter(Boolean).join(' ');
  return (
    <button type="button" className={classes} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <span className={styles.actionSpinner} aria-hidden="true" /> : icon && <span className={styles.actionIcon}>{icon}</span>}
      <span>{loading ? loadingLabel || children : children}</span>
    </button>
  );
}
