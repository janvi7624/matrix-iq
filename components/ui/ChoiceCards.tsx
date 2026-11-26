'use client';

import type { LucideIcon } from 'lucide-react';
import styles from './choiceCards.module.css';

// Big, obvious "tap one" cards — replaces a native select or small pill toggle
// where people didn't know what to click. Same value/onChange contract as a
// select, so swapping one in changes nothing about the surrounding logic.

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
  icon?: LucideIcon;
}

interface ChoiceCardsProps<T extends string> {
  step?: number;
  title: string;
  subtitle?: string;
  options: ChoiceOption<T>[];
  value: T | '';
  onChange: (value: T) => void;
  compact?: boolean;
}

export default function ChoiceCards<T extends string>({ step, title, subtitle, options, value, onChange, compact }: ChoiceCardsProps<T>) {
  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        {step !== undefined && <span className={`${styles.stepNo} ${value ? styles.stepDone : ''}`}>{value ? '✓' : step}</span>}
        <div>
          <div className={styles.title}>{title}</div>
          {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
        </div>
      </div>
      <div className={`${styles.grid} ${compact ? styles.compact : ''}`} role="radiogroup" aria-label={title}>
        {options.map((o) => {
          const on = value === o.value;
          const Icon = o.icon;
          return (
            <button key={o.value} type="button" role="radio" aria-checked={on} className={`${styles.card} ${on ? styles.on : ''}`} onClick={() => onChange(o.value)}>
              {Icon && (
                <span className={styles.icon}>
                  <Icon size={compact ? 18 : 22} />
                </span>
              )}
              <span className={styles.text}>
                <strong>{o.label}</strong>
                {o.hint && <small>{o.hint}</small>}
              </span>
              {on && <span className={styles.tick}>✓</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function StepLabel({ step, done, title, subtitle }: { step: number; done?: boolean; title: string; subtitle?: string }) {
  return (
    <div className={styles.head}>
      <span className={`${styles.stepNo} ${done ? styles.stepDone : ''}`}>{done ? '✓' : step}</span>
      <div>
        <div className={styles.title}>{title}</div>
        {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
      </div>
    </div>
  );
}
