'use client';

import calcStyles from '../calculator.module.css';
import { OPPORTUNITY_TYPES, OPPORTUNITY_TYPE_LABEL, OpportunityType } from '@/lib/projectLeadOptions';

interface OpportunityTypeFieldProps {
  value: OpportunityType | '';
  onChange: (type: OpportunityType | '') => void;
  required?: boolean;
  disabled?: boolean;
}

// Distribution vs Project. Picking one pre-fills the Project Lead (Distribution
// -> Manoj Menon, Project -> Pankaj Sharma) — the parent form does that with
// nextLeadOnTypeChange (lib/projectLeadOptions.ts) so a lead chosen on purpose
// isn't overwritten; the lead stays editable either way.
export default function OpportunityTypeField({ value, onChange, required, disabled }: OpportunityTypeFieldProps) {
  return (
    <select className={calcStyles.formControl} required={required} disabled={disabled} value={value} onChange={(e) => onChange(e.target.value as OpportunityType | '')}>
      <option value="">— Select type —</option>
      {OPPORTUNITY_TYPES.map((t) => <option key={t} value={t}>{OPPORTUNITY_TYPE_LABEL[t]}</option>)}
    </select>
  );
}
