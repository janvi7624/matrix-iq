'use client';

import Select from './ui/Select';
import styles from './dailyReport.module.css';

export interface TmsProjectOption {
  id: string;
  name: string;
  departmentName: string;
}

// The "turn this plain note into a real TMS task" dropdown on a standalone
// AI row — the employee's own TMS projects (project manager, creator, or
// team member). Purely presentational: DailyReportForm.tsx fetches the
// project list ONCE for the whole report (components/DailyReportForm.tsx's
// tmsProjects state) and passes it to every standalone row's copy of this,
// rather than each row fetching its own — there's one project list per
// employee, not one per row. Optional by design: leaving it on "Keep as a
// plain note" is the default and the row behaves exactly as it does today.
// Picking a project doesn't create anything by itself — the actual task is
// only created on submit (lib/aiTmsTaskLink.ts's
// createPendingTmsTasksFromEntries), never from a draft.
export default function TmsNewTaskProjectSelect({
  projects,
  error,
  value,
  onChange
}: {
  projects: TmsProjectOption[] | null;
  error: string;
  value: string;
  onChange: (projectId: string) => void;
}) {
  if (error) return <div className={styles.errorText}>{error}</div>;
  // Nothing to offer and nothing already chosen — stay out of the way
  // rather than showing an empty dropdown on every single row.
  if (projects !== null && projects.length === 0 && !value) return null;

  return (
    <div className={styles.tmsNewTaskPicker}>
      <label className={styles.tmsNewTaskLabel}>Create TMS Task In Project</label>
      {projects === null ? (
        <div className={styles.tmsNewTaskHint}>Loading your TMS projects…</div>
      ) : (
        <>
          <Select value={value} onChange={(e) => onChange(e.target.value)}>
            <option value="">— Keep as a plain note —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
          {value && (
            <div className={styles.tmsNewTaskHint}>
              Becomes a real TMS task, assigned to you, when you submit this report — not before.
            </div>
          )}
        </>
      )}
    </div>
  );
}
