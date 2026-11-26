'use client';

import Link from '@/components/ui/AppLink';
import { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import styles from './commonButton.module.css';

export type CommonButtonVariant =
  | 'primary'
  | 'secondary'
  | 'outlined'
  | 'ghost'
  | 'destructive'
  | 'destructiveSolid'
  | 'success'
  | 'warning'
  | 'link';
export type CommonButtonSize = 'sm' | 'md' | 'lg';
export type CommonButtonTone = 'default' | 'inverse';

interface CommonButtonOwnProps {
  variant?: CommonButtonVariant;
  size?: CommonButtonSize;
  /** `inverse` adapts ghost/focus colours for a dark surface such as the app header. */
  tone?: CommonButtonTone;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  /** Renders only the icon; `aria-label` is then required for a screen-reader name. */
  iconOnly?: boolean;
  /** Toggle-button state — sets aria-pressed and the solid "selected" look. */
  selected?: boolean;
  /** Disclosure state (show/hide a panel) — sets aria-expanded; use instead of `selected` for disclosures. */
  expanded?: boolean;
  loading?: boolean;
  /** Text shown while loading; defaults to the normal label. */
  loadingLabel?: ReactNode;
  fullWidth?: boolean;
  /** Below 640px show only the icon (needs a leadingIcon); the text label stays the accessible name. */
  collapseOnPhone?: boolean;
  className?: string;
  children?: ReactNode;
}

export type CommonButtonAsButton = CommonButtonOwnProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof CommonButtonOwnProps> & {
    href?: undefined;
    ref?: Ref<HTMLButtonElement>;
  };

export type CommonButtonAsLink = CommonButtonOwnProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof CommonButtonOwnProps | 'href'> & {
    /** Renders a next/link styled as a button. */
    href: string;
    disabled?: boolean;
    /** Use a plain <a> (downloads, external, API file routes) instead of next/link. */
    native?: boolean;
    ref?: Ref<HTMLAnchorElement>;
  };

export type CommonButtonProps = CommonButtonAsButton | CommonButtonAsLink;

/** Pure class-name builder — exported so it can be unit tested without a DOM. */
export function commonButtonClassName({
  variant = 'secondary',
  size = 'md',
  tone = 'default',
  iconOnly = false,
  selected = false,
  loading = false,
  fullWidth = false,
  collapseOnPhone = false,
  className
}: Pick<CommonButtonOwnProps, 'variant' | 'size' | 'tone' | 'iconOnly' | 'selected' | 'loading' | 'fullWidth' | 'collapseOnPhone' | 'className'>): string {
  return [
    styles.root,
    styles[size],
    styles[variant],
    tone === 'inverse' ? styles.inverse : '',
    iconOnly ? styles.iconOnly : '',
    selected ? styles.selected : '',
    loading ? styles.loading : '',
    fullWidth ? styles.fullWidth : '',
    collapseOnPhone ? styles.collapseOnPhone : '',
    className || ''
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * The one button for the whole app.
 *
 * - variants: primary · secondary · outlined · ghost · destructive · destructiveSolid · success · warning · link
 * - sizes: sm · md · lg (heights from --mx-btn-h-*)
 * - states: hover · active · selected (aria-pressed) · disabled · loading
 * - leading/trailing icon, icon-only (needs aria-label), full width
 * - pass `href` to render a next/link (or `native` for a plain <a>) with the same look
 */
export default function CommonButton(props: CommonButtonProps) {
  const {
    variant = 'secondary',
    size = 'md',
    tone = 'default',
    leadingIcon,
    trailingIcon,
    iconOnly = false,
    selected,
    expanded,
    loading = false,
    loadingLabel,
    fullWidth = false,
    collapseOnPhone = false,
    className,
    children,
    ...rest
  } = props;

  if (process.env.NODE_ENV !== 'production' && iconOnly && !rest['aria-label'] && !rest.title) {
    console.warn('CommonButton: icon-only buttons need an aria-label.');
  }

  const classes = commonButtonClassName({ variant, size, tone, iconOnly, selected, loading, fullWidth, collapseOnPhone, className });
  // When the label is hidden on phones, it must still name the control.
  if (collapseOnPhone && typeof children === 'string' && !rest['aria-label']) {
    (rest as { 'aria-label'?: string })['aria-label'] = children;
  }

  const content = (
    <>
      {loading ? (
        <span className={styles.spinner} aria-hidden="true" />
      ) : (
        leadingIcon && (
          <span className={styles.icon} aria-hidden="true">
            {leadingIcon}
          </span>
        )
      )}
      {!iconOnly && (children !== undefined || loadingLabel !== undefined) && (
        <span className={styles.label}>{loading && loadingLabel !== undefined ? loadingLabel : children}</span>
      )}
      {iconOnly && !loading && children !== undefined && !leadingIcon && (
        <span className={styles.icon} aria-hidden="true">
          {children}
        </span>
      )}
      {!loading && trailingIcon && (
        <span className={styles.icon} aria-hidden="true">
          {trailingIcon}
        </span>
      )}
    </>
  );

  if (typeof props.href === 'string') {
    const { href, disabled, native, ref, ...anchorRest } = rest as Omit<CommonButtonAsLink, keyof CommonButtonOwnProps>;
    if (disabled) {
      // A disabled link has no href, so it is not focusable or followable.
      return (
        <a className={classes} aria-disabled="true" role="link" {...anchorRest}>
          {content}
        </a>
      );
    }
    if (native) {
      return (
        <a ref={ref} href={href} className={classes} {...anchorRest}>
          {content}
        </a>
      );
    }
    return (
      <Link ref={ref} href={href} className={classes} {...anchorRest}>
        {content}
      </Link>
    );
  }

  const { type = 'button', disabled, ref, ...buttonRest } = rest as Omit<CommonButtonAsButton, keyof CommonButtonOwnProps>;
  return (
    <button
      ref={ref}
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-pressed={selected === undefined ? undefined : selected}
      aria-expanded={expanded}
      aria-busy={loading || undefined}
      {...buttonRest}
    >
      {content}
    </button>
  );
}
