'use client';

import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';

function toggleInArray(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

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
  return (
    <div className={calcStyles.field}>
      <label className={calcStyles.label}>{label}</label>
      <div className={historyStyles.teamGrid}>
        {options.map((name) => (
          <label key={name}>
            <input type="checkbox" checked={selected.includes(name)} onChange={() => onChange(toggleInArray(selected, name))} />
            {name}
          </label>
        ))}
      </div>
    </div>
  );
}
