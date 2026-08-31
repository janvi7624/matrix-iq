import { ReactNode } from 'react';
import calcStyles from '../calculator.module.css';

export function Field({ label, htmlFor, children, className }: { label?: ReactNode; htmlFor?: string; children: ReactNode; className?: string }) {
  const classes = [calcStyles.field, className || ''].filter(Boolean).join(' ');
  return (
    <div className={classes}>
      {label && <label className={calcStyles.label} htmlFor={htmlFor}>{label}</label>}
      {children}
    </div>
  );
}

// Two-column row grouping — `.columns` is hardcoded 1fr 1fr in
// calculator.module.css, so a 3rd field wraps onto its own row (deliberate;
// reproduces the app's existing edit-dialog layouts exactly).
export function FieldRow({ children, className }: { children: ReactNode; className?: string }) {
  const classes = [calcStyles.row, calcStyles.columns, className || ''].filter(Boolean).join(' ');
  return <div className={classes}>{children}</div>;
}
