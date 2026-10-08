'use client';

import calcStyles from '../calculator.module.css';
import {
  DepartmentAmounts,
  PROJECT_DEPARTMENTS,
  PROJECT_DEPARTMENT_LABEL,
  ProjectDepartment,
  sumDepartmentAmounts
} from '@/lib/projectDepartmentOptions';
import { formatMoney } from '@/lib/format';

interface ProjectDepartmentFieldProps {
  departments: ProjectDepartment[];
  amounts: DepartmentAmounts;
  onChange: (departments: ProjectDepartment[], amounts: DepartmentAmounts) => void;
  disabled?: boolean;
}

// Tick every department working the deal; once more than one is ticked, each
// gets its own approx. value — the 27L / 23L of a 50L AI+AV project.
//
// The per-department boxes appear ONLY for a multi-department project. With a
// single department there is nothing to divide: its share is the project's
// whole approx_price, and asking for the same number twice would just be a
// second place for it to go stale (departmentValueOf relies on that).
export default function ProjectDepartmentField({ departments, amounts, onChange, disabled }: ProjectDepartmentFieldProps) {
  const multi = departments.length > 1;
  const splitTotal = sumDepartmentAmounts(amounts);

  function toggle(department: ProjectDepartment) {
    const picked = new Set(departments);
    if (picked.has(department)) picked.delete(department);
    else picked.add(department);
    // Canonical order, so "AI + AV" stores the same whichever box went first.
    const next = PROJECT_DEPARTMENTS.filter((d) => picked.has(d));
    // Drop the amount of any department just unticked, so a removed
    // department can't leave its value behind in the split.
    const nextAmounts: DepartmentAmounts = {};
    for (const d of next) if (amounts[d] !== undefined) nextAmounts[d] = amounts[d];
    onChange(next, nextAmounts);
  }

  function setAmount(department: ProjectDepartment, raw: string) {
    const next: DepartmentAmounts = { ...amounts };
    const num = Number(raw);
    if (!raw.trim() || !Number.isFinite(num) || num <= 0) delete next[department];
    else next[department] = num;
    onChange(departments, next);
  }

  return (
    <>
      <div className={calcStyles.deptPickRow} role="group" aria-label="Department">
        {PROJECT_DEPARTMENTS.map((d) => {
          const on = departments.includes(d);
          return (
            <button
              key={d}
              type="button"
              role="checkbox"
              aria-checked={on}
              disabled={disabled}
              className={`${calcStyles.deptPickChip} ${on ? calcStyles.deptPickChipActive : ''}`}
              onClick={() => toggle(d)}
            >
              <span className={calcStyles.deptPickChipCheck} aria-hidden="true" />
              {PROJECT_DEPARTMENT_LABEL[d]}
            </button>
          );
        })}
      </div>

      {multi && (
        <div className={calcStyles.deptAmountBox}>
          <div className={calcStyles.deptAmountHint}>Approx. value per department</div>
          {departments.map((d) => (
            <div key={d} className={calcStyles.deptAmountRow}>
              <span className={calcStyles.deptAmountLabel}>{PROJECT_DEPARTMENT_LABEL[d]}</span>
              <input
                type="number"
                min="0"
                step="any"
                className={calcStyles.formControl}
                disabled={disabled}
                placeholder="0"
                value={amounts[d] ?? ''}
                onChange={(e) => setAmount(d, e.target.value)}
              />
            </div>
          ))}
          {/* The project's own Approx. Price is this sum — shown live so the
              two can't be entered as different numbers. */}
          <div className={calcStyles.deptAmountTotal}>
            Total project value <b>{formatMoney(splitTotal)}</b>
          </div>
        </div>
      )}
    </>
  );
}
