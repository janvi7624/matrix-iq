'use client';

import calcStyles from './calculator.module.css';
import styles from './teamCheckboxes.module.css';

function toggleInArray(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}

// Multi-select of people as themed chips (initials avatar, red when picked).
// Selection is name-based, same as before.
export default function TeamCheckboxes({
  label,
  options,
  selected,
  onChange
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const count = selected.filter((s) => options.includes(s)).length;
  return (
    <div className={calcStyles.field}>
      <div className={styles.head}>
        <span className={styles.label}>{label}</span>
        {count > 0 && <span className={styles.count}>{count} selected</span>}
      </div>
      {options.length === 0 ? (
        <div className={styles.empty}>No one available to pick.</div>
      ) : (
        <div className={styles.chips}>
          {options.map((name, i) => {
            const on = selected.includes(name);
            return (
              // Keyed by name+index: options are plain display names and two
              // people can share a name.
              <label key={`${name}-${i}`} className={`${styles.chip} ${on ? styles.on : ''}`}>
                <input type="checkbox" checked={on} onChange={() => onChange(toggleInArray(selected, name))} />
                <span className={styles.avatar} aria-hidden="true">{on ? '✓' : initials(name)}</span>
                {name}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
