'use client';

import Select from './ui/Select';
import calcStyles from './calculator.module.css';
import styles from './dailyReport.module.css';

export const OTHER_VALUE = 'Other';

export interface TmsProjectOption {
  id: string;
  name: string;
  departmentName: string;
}

// AI_TEMPLATE's `project` field, bespoke-rendered (see its own doc comment
// in lib/dailyReportTemplates.ts for why: the real options are this
// employee's TMS projects, fetched data, not a fixed list a template can
// declare). Required on every task row, management's own call: a task
// either names a real TMS project (and becomes a tracked, two-way-synced
// task on submit) or is explicitly marked "Other" (and stays a plain,
// untracked note) — there is no third, unstated option anymore.
//
// Purely presentational: DailyReportForm.tsx fetches the project list ONCE
// for the whole report and passes it down, rather than each row fetching
// its own — there's one project list per employee, not one per row.
export default function TmsNewTaskProjectSelect({
  projects,
  error,
  projectId,
  projectName,
  locked,
  onChange
}: {
  projects: TmsProjectOption[] | null;
  error: string;
  /** The entry's current tms_project_id — '' for both "nothing chosen yet" and "Other". */
  projectId: string;
  /** The entry's current project — a real project's name, 'Other', or '' if nothing chosen yet. */
  projectName: string;
  /** True for an auto/linked row — read-only display instead of a control,
   *  same as every other TMS-sourced field on that row (isAutoRow). */
  locked: boolean;
  onChange: (selection: { projectId: string; projectName: string }) => void;
}) {
  if (error) return <div className={styles.errorText}>{error}</div>;

  // A locked row (however it got linked — picked from the existing-task
  // picker, converted, or created via this same dropdown on an earlier
  // save) just shows the real project name as read-only text, matching
  // every other TMS-sourced field's own computed-field styling.
  if (locked) {
    return (
      <div className={`${calcStyles.field} ${styles.tmsNewTaskPicker}`}>
        <label className={calcStyles.label}>Project / Category</label>
        <div className={styles.computedValue}>{projectName || '—'}</div>
      </div>
    );
  }

  // What the <select> itself shows as selected: the project's id if one is
  // chosen, the literal OTHER_VALUE sentinel if Other was, otherwise blank
  // (including right after an unlink — see aiTmsTaskLink.ts's own comment
  // on why that clears `project` rather than leaving a stale name behind).
  const selectValue = projectId || (projectName === OTHER_VALUE ? OTHER_VALUE : '');

  function handleChange(value: string) {
    if (value === OTHER_VALUE) {
      onChange({ projectId: '', projectName: OTHER_VALUE });
      return;
    }
    const project = projects?.find((p) => p.id === value);
    onChange({ projectId: value, projectName: project?.name ?? '' });
  }

  return (
    <div className={`${calcStyles.field} ${styles.tmsNewTaskPicker}`}>
      <label className={calcStyles.label}>
        Project / Category
        <span aria-hidden="true"> *</span>
      </label>
      {projects === null ? (
        <div className={calcStyles.small}>Loading your TMS projects…</div>
      ) : (
        <Select value={selectValue} onChange={(e) => handleChange(e.target.value)}>
          <option value="">— Select —</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
          <option value={OTHER_VALUE}>Other (not tracked in TMS)</option>
        </Select>
      )}
      {projectId && (
        <div className={calcStyles.small}>
          Becomes a real TMS task, assigned to you, when you submit this report — not before.
        </div>
      )}
    </div>
  );
}
