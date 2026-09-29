'use client';

import { useState } from 'react';
import calcStyles from '../calculator.module.css';
import {
  COMBINED_VALUE,
  PROJECT_DEPARTMENTS,
  PROJECT_DEPARTMENT_LABEL,
  ProjectDepartment,
  ProjectDepartmentMode,
  departmentModeFor
} from '@/lib/projectDepartmentOptions';

interface ProjectDepartmentFieldProps {
  value: ProjectDepartment[];
  onChange: (departments: ProjectDepartment[]) => void;
  disabled?: boolean;
}

// AI / AV / Robotics, plus "Combined" for a deal spanning more than one.
//
// Only the LIST is ever stored — there is no "is combined" column, because a
// second source of truth could disagree with the list it describes (claiming
// Combined while holding one department). Combined is therefore derived on
// read: length > 1.
//
// Whether the checkboxes are OPEN is a different question from what is saved,
// though, and it has to be local state rather than derived: deriving it would
// mean unticking down to one box silently collapses the checkboxes and jumps
// the select back to that single department, mid-edit. So the toggle is held
// here, seeded from the saved value for an existing project. This component
// unmounts with the New Project form (ProjectsView sets showForm false after
// a create), so the state resets on its own — no syncing effect needed.
//
// Combined with only one department ticked saves as that single department,
// which is simply the truth about the deal; nothing is lost or silently
// altered, so it is not treated as an error.
export default function ProjectDepartmentField({ value, onChange, disabled }: ProjectDepartmentFieldProps) {
  const [combinedOpen, setCombinedOpen] = useState(() => value.length > 1);
  const mode: ProjectDepartmentMode = combinedOpen || value.length > 1 ? COMBINED_VALUE : departmentModeFor(value);

  function handleModeChange(next: ProjectDepartmentMode) {
    if (next === COMBINED_VALUE) {
      // Keep whatever single department was already picked, so AI -> Combined
      // starts from AI instead of making the person re-tick it.
      setCombinedOpen(true);
      return;
    }
    setCombinedOpen(false);
    onChange(next ? [next] : []);
  }

  function toggle(department: ProjectDepartment) {
    const picked = new Set(value);
    if (picked.has(department)) picked.delete(department);
    else picked.add(department);
    // Re-ordered by the canonical list so "AI + AV" stores identically
    // whichever box was ticked first, and compares equal downstream.
    onChange(PROJECT_DEPARTMENTS.filter((d) => picked.has(d)));
  }

  return (
    <>
      <select
        className={calcStyles.formControl}
        disabled={disabled}
        value={mode}
        onChange={(e) => handleModeChange(e.target.value as ProjectDepartmentMode)}
      >
        <option value="">— Select department —</option>
        {PROJECT_DEPARTMENTS.map((d) => (
          <option key={d} value={d}>{PROJECT_DEPARTMENT_LABEL[d]}</option>
        ))}
        <option value={COMBINED_VALUE}>Combined (more than one)</option>
      </select>
      {mode === COMBINED_VALUE && (
        <div className={calcStyles.checkRow}>
          {PROJECT_DEPARTMENTS.map((d) => (
            <label key={d} className={calcStyles.checkLabel}>
              <input
                type="checkbox"
                disabled={disabled}
                checked={value.includes(d)}
                onChange={() => toggle(d)}
              />
              {PROJECT_DEPARTMENT_LABEL[d]}
            </label>
          ))}
        </div>
      )}
    </>
  );
}
