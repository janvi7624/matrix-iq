'use client';

import { ButtonHTMLAttributes } from 'react';
import calcStyles from '../calculator.module.css';

export type SubmitButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

// Wraps calculator.module.css's .btn — the primary "save this new record"
// button used across the simple record-list forms (Negotiation, Customer
// Response, PO, Installation, etc.). Distinct from ToolbarButton's
// .button/.primary family and Button.tsx's .actionBtn family — each is a
// visually different existing button style; not merged, to avoid changing
// any of their appearances.
export default function SubmitButton({ className, ...rest }: SubmitButtonProps) {
  const classes = [calcStyles.btn, className || ''].filter(Boolean).join(' ');
  return <button type="submit" className={classes} {...rest} />;
}
