'use client';

import calcStyles from '../calculator.module.css';
import { useProjectLeads } from './useProjectLeads';

interface ProjectLeadFieldProps {
  value: string;
  onChange: (userId: string) => void;
  required?: boolean;
  disabled?: boolean;
}

// Project Lead / Mentor dropdown — a fixed short list (lib/projectLeadOptions.ts),
// same idea as ProjectSourceField's fixed Source list, but the value is the
// lead's user id since the lead sees their led projects in their own Project
// Dashboard. Options come from GET /api/projects/leads so a deactivated lead
// drops out here without a code change.
export default function ProjectLeadField({ value, onChange, required, disabled }: ProjectLeadFieldProps) {
  const leads = useProjectLeads();
  return (
    <select className={calcStyles.formControl} required={required} disabled={disabled || !leads} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{!leads ? 'Loading…' : '— Select project lead —'}</option>
      {(leads || []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
    </select>
  );
}
