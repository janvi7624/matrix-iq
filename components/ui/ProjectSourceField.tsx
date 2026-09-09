'use client';

import { useState } from 'react';
import calcStyles from '../calculator.module.css';
import { PROJECT_SOURCE_OPTIONS } from '@/lib/projectSourceOptions';

interface ProjectSourceFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Marks the dropdown required — and, when "Other" is picked, the free-text box too, so a bare "Other" with no actual text can't satisfy native form validation. */
  required?: boolean;
}

// Fixed dropdown (lib/projectSourceOptions.ts) with an "Other" escape hatch
// that preserves free text. Project.source predates this dropdown, so
// existing values that don't match an option exactly (e.g. "Mayank Sir",
// "India Mart", "GeM" typed by hand) land on "Other" with their original
// text intact rather than being silently dropped.
export default function ProjectSourceField({ value, onChange, required }: ProjectSourceFieldProps) {
  const isKnown = value === '' || (PROJECT_SOURCE_OPTIONS as readonly string[]).includes(value);
  const [forceOther, setForceOther] = useState(false);
  const showOther = forceOther || (!isKnown && value !== '');
  const selectValue = showOther ? 'Other' : value;

  return (
    <>
      <select
        className={calcStyles.formControl}
        required={required}
        value={selectValue}
        onChange={(e) => {
          const v = e.target.value;
          if (v === 'Other') { setForceOther(true); onChange(''); }
          else { setForceOther(false); onChange(v); }
        }}
      >
        <option value="">— Select source —</option>
        {PROJECT_SOURCE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      {showOther && (
        <input
          type="text"
          className={`${calcStyles.formControl} ${calcStyles.mt6}`}
          placeholder="Specify source"
          required={required}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </>
  );
}
