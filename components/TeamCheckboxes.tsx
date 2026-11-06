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
        {options.map((name, i) => (
          // Keyed by name+index, not name alone: options are plain display-
          // name strings (no id to key by — this component's whole selection
          // model is name-based, not id-based), and two people can
          // legitimately share a name. Keying by name alone then collides —
          // caught live when two QA fixtures both named "QA Test TravelRace"
          // produced a duplicate-key React warning on this exact list.
          <label key={`${name}-${i}`}>
            <input type="checkbox" checked={selected.includes(name)} onChange={() => onChange(toggleInArray(selected, name))} />
            {name}
          </label>
        ))}
      </div>
    </div>
  );
}
