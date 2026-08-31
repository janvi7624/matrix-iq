'use client';

import { AnchorHTMLAttributes, ButtonHTMLAttributes } from 'react';
import styles from '../quotationHistory.module.css';

// Wraps quotationHistory.module.css's .button/.primary/.deleteBtn family —
// visually distinct from components/ui/Button.tsx's .actionBtn family used
// elsewhere in the app. Deliberately NOT merged with Button: they render
// differently, and swapping call sites over would change their appearance.
export default function ToolbarButton({ primary, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
  const classes = [styles.button, primary ? styles.primary : '', className || ''].filter(Boolean).join(' ');
  return <button type="button" className={classes} {...rest} />;
}

export function ToolbarLink({ className, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const classes = [styles.button, className || ''].filter(Boolean).join(' ');
  return <a className={classes} {...rest} />;
}

export function DeleteButton({ className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const classes = [styles.deleteBtn, className || ''].filter(Boolean).join(' ');
  return <button type="button" className={classes} {...rest} />;
}
