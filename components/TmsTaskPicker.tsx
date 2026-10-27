'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search, Loader2 } from 'lucide-react';
import Modal from './ui/Modal';
import Input from './ui/Input';
import { TMS_TASK_STATUS_LABEL, TMS_PRIORITY_LABEL, formatTmsDueDate } from '@/lib/tmsLabels';
import calcStyles from './calculator.module.css';
import styles from './dailyReport.module.css';

export interface TmsLinkableTask {
  id: string;
  name: string;
  description: string;
  projectName: string;
  status: string;
  priority: string;
  dueDate: string;
  progressPercent: number;
}

// "Select Existing TMS Task" — the employee's own open work, searchable by
// task name, project, and status (per the integration brief). Fetched fresh
// every time it opens rather than cached: a task someone else just
// reassigned away, or one completed since the last report, should not be
// offered.
export default function TmsTaskPicker({
  employeeId,
  onClose,
  onSelect
}: {
  employeeId?: string;
  onClose: () => void;
  onSelect: (task: TmsLinkableTask) => void;
}) {
  const [tasks, setTasks] = useState<TmsLinkableTask[] | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams();
        if (employeeId) params.set('employeeId', employeeId);
        const response = await fetch(`/api/daily-reports/tms-tasks?${params.toString()}`);
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          if (!cancelled) setError(body?.error || 'Could not load your TMS tasks.');
          return;
        }
        const body: { tasks: TmsLinkableTask[] } = await response.json();
        if (!cancelled) setTasks(body.tasks);
      } catch {
        if (!cancelled) setError('Could not reach the server.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [employeeId]);

  const filtered = useMemo(() => {
    if (!tasks) return [];
    const q = search.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.projectName.toLowerCase().includes(q) ||
        (TMS_TASK_STATUS_LABEL[t.status as keyof typeof TMS_TASK_STATUS_LABEL] ?? t.status).toLowerCase().includes(q)
    );
  }, [tasks, search]);

  return (
    <Modal title="Select a TMS task" ariaLabel="Select an existing TMS task to link" onClose={onClose} size="wide">
      <div className={styles.tmsPickerSearch}>
        <Search size={15} aria-hidden="true" />
        <Input
          type="text"
          placeholder="Search by task name, project or status…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
      </div>

      {tasks === null && !error && (
        <div className={calcStyles.small}>
          <Loader2 size={14} className={styles.spin} /> Loading your TMS tasks…
        </div>
      )}
      {error && <div className={styles.errorText}>{error}</div>}
      {tasks !== null && !error && filtered.length === 0 && (
        <div className={calcStyles.small}>
          {tasks.length === 0
            ? 'No open TMS tasks are assigned to you right now.'
            : 'Nothing matches that search.'}
        </div>
      )}

      {filtered.length > 0 && (
        <div className={styles.tmsPickerList}>
          {filtered.map((task) => (
            <button key={task.id} type="button" className={styles.tmsPickerRow} onClick={() => onSelect(task)}>
              <div className={styles.tmsPickerRowMain}>
                <span className={styles.tmsPickerRowName}>{task.name}</span>
                <span className={styles.tmsPickerRowProject}>{task.projectName}</span>
              </div>
              <div className={styles.tmsPickerRowMeta}>
                <span>{TMS_TASK_STATUS_LABEL[task.status as keyof typeof TMS_TASK_STATUS_LABEL] ?? task.status}</span>
                <span>{TMS_PRIORITY_LABEL[task.priority as keyof typeof TMS_PRIORITY_LABEL] ?? task.priority}</span>
                <span>Due {formatTmsDueDate(task.dueDate)}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
