'use client';

import calcStyles from './calculator.module.css';
import styles from './teamCheckboxes.module.css';
import CommonChip from './ui/CommonChip';

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
              <CommonChip
                key={`${name}-${i}`}
                selected={on}
                leadingIcon={<span className={styles.avatar}>{initials(name)}</span>}
                onClick={() => onChange(toggleInArray(selected, name))}
              >
                {name}
              </CommonChip>
            );
          })}
        </div>
      )}
    </div>
  );
}
