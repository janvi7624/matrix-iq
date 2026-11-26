'use client';

import { ButtonHTMLAttributes, ReactNode } from 'react';
import CommonButton, { CommonButtonVariant } from './CommonButton';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'success' | 'ghost';

const VARIANT_MAP: Record<ButtonVariant, CommonButtonVariant> = {
  primary: 'primary',
  secondary: 'secondary',
  danger: 'destructive',
  success: 'success',
  ghost: 'ghost'
};

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: ButtonVariant;
  compact?: boolean;
  icon?: ReactNode;
  loading?: boolean;
  loadingLabel?: string;
  children: ReactNode;
}

// Back-compat wrapper: existing callers keep this API, rendering goes
// through CommonButton so they share the app-wide button styles.
// `compact` maps to size="sm" for dense inline row actions.
export default function Button({ variant = 'secondary', compact = false, icon, loading = false, loadingLabel, children, ...rest }: ButtonProps) {
  return (
    <CommonButton
      variant={VARIANT_MAP[variant]}
      size={compact ? 'sm' : 'md'}
      leadingIcon={icon}
      loading={loading}
      loadingLabel={loadingLabel}
      {...rest}
    >
      {children}
    </CommonButton>
  );
}
