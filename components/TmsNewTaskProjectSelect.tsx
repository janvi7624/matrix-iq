'use client';

import Select from './ui/Select';
import calcStyles from './calculator.module.css';
import styles from './dailyReport.module.css';

export const OTHER_VALUE = 'Other';

// A plain id collides between the two groups (a TMS project and a Sales
// Project can share a UUID purely by chance), so each <option>'s value is
// prefixed by which list it came from — parsed back out in handleChange.
const SALES_PREFIX = 'sales:';

export interface TmsProjectOption {
  id: string;
  name: string;
  departmentName: string;
}

// An ongoing Sales Project the employee is a formally assigned technical
// person on (lib/projectStore.ts's listOngoingAssignedProjects) — picking
// one is just a note against that deal: nothing is created or synced in
// TMS for it, unlike a TmsProjectOption pick below.
export interface SalesProjectOption {
  id: string;
  name: string;
}

// AI_TEMPLATE's `project` field, bespoke-rendered (see its own doc comment
// in lib/dailyReportTemplates.ts for why: the real options are this
// employee's TMS projects, fetched data, not a fixed list a template can
// declare). Required on every task row, management's own call: a task
// either names a real TMS project (and becomes a tracked, two-way-synced
// task on submit), an ongoing Sales Project they're assigned to (and stays a
// plain note against that deal), or is explicitly marked "Other" (and stays
// a plain, untracked note) — there is no fourth, unstated option.
//
// Purely presentational: DailyReportForm.tsx fetches both lists ONCE for the
// whole report and passes them down, rather than each row fetching its own
// — there's one pair of lists per employee, not one per row.
export default function TmsNewTaskProjectSelect({
  projects,
  salesProjects,
  error,
  projectId,
  salesProjectId,
  projectName,
  locked,
  onChange
}: {
  projects: TmsProjectOption[] | null;
  salesProjects: SalesProjectOption[] | null;
  error: string;
  /** The entry's current tms_project_id — '' for "nothing chosen", "Other", or a Sales Project pick. */
  projectId: string;
  /** The entry's current sales_project_id — '' unless a Sales Project was picked. */
  salesProjectId: string;
  /** The entry's current project — a real project's name, 'Other', or '' if nothing chosen yet. */
  projectName: string;
  /** True for an auto/linked row — read-only display instead of a control,
   *  same as every other TMS-sourced field on that row (isAutoRow). */
  locked: boolean;
  onChange: (selection: { projectId: string; salesProjectId: string; projectName: string }) => void;
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

  // What the <select> itself shows as selected: the TMS project's id, the
  // Sales Project's id (prefixed, to tell the two groups apart), the literal
  // OTHER_VALUE sentinel, or blank — including right after an unlink (see
  // aiTmsTaskLink.ts's own comment on why that clears `project` rather than
  // leaving a stale name behind).
  const selectValue = projectId || (salesProjectId ? `${SALES_PREFIX}${salesProjectId}` : '') || (projectName === OTHER_VALUE ? OTHER_VALUE : '');

  function handleChange(value: string) {
    if (value === OTHER_VALUE) {
      onChange({ projectId: '', salesProjectId: '', projectName: OTHER_VALUE });
      return;
    }
    if (value.startsWith(SALES_PREFIX)) {
      const id = value.slice(SALES_PREFIX.length);
      const sp = salesProjects?.find((p) => p.id === id);
      onChange({ projectId: '', salesProjectId: id, projectName: sp?.name ?? '' });
      return;
    }
    const project = projects?.find((p) => p.id === value);
    onChange({ projectId: value, salesProjectId: '', projectName: project?.name ?? '' });
  }

  const stillLoading = projects === null || salesProjects === null;

  return (
    <div className={`${calcStyles.field} ${styles.tmsNewTaskPicker}`}>
      <label className={calcStyles.label}>
        Project / Category
        <span aria-hidden="true"> *</span>
      </label>
      {stillLoading ? (
        <div className={calcStyles.small}>Loading your TMS and Sales projects…</div>
      ) : (
        <Select value={selectValue} onChange={(e) => handleChange(e.target.value)}>
          <option value="">— Select —</option>
          {projects && projects.length > 0 && (
            <optgroup label="TMS Projects">
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </optgroup>
          )}
          {salesProjects && salesProjects.length > 0 && (
            <optgroup label="Sales Projects (ongoing, assigned to you)">
              {salesProjects.map((p) => (
                <option key={p.id} value={`${SALES_PREFIX}${p.id}`}>{p.name}</option>
              ))}
            </optgroup>
          )}
          <option value={OTHER_VALUE}>Other (not tracked in TMS)</option>
        </Select>
      )}
      {projectId && (
        <div className={calcStyles.small}>
          Becomes a real TMS task, assigned to you, when you submit this report — not before.
        </div>
      )}
      {salesProjectId && (
        <div className={calcStyles.small}>
          Logged as a note against this Sales Project — no TMS task is created.
        </div>
      )}
    </div>
  );
}
