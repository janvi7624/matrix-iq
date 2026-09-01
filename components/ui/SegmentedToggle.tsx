'use client';

import { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from '../quotationHistory.module.css';

export interface SegmentedOption<V extends string> {
  value: V;
  label: ReactNode;
}

export interface SegmentedToggleProps<V extends string> {
  options: SegmentedOption<V>[];
  value: V;
  onChange: (value: V) => void;
}

// Wraps .modeToggle/.modeToggleBtn(+Active). onChange fires on every click,
// including re-selecting the already-active option — some callers (e.g.
// Leads' "All Leads") rely on that to re-fetch even when already selected.
export default function SegmentedToggle<V extends string>({ options, value, onChange }: SegmentedToggleProps<V>) {
  return (
    <div className={styles.modeToggle}>
      {options.map((opt) => (
        <SegmentedButton key={opt.value} active={opt.value === value} onClick={() => onChange(opt.value)}>
          {opt.label}
        </SegmentedButton>
      ))}
    </div>
  );
}

export function SegmentedButton({ active, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  const classes = [styles.modeToggleBtn, active ? styles.modeToggleBtnActive : '', className || ''].filter(Boolean).join(' ');
  return <button type="button" className={classes} {...rest} />;
}
