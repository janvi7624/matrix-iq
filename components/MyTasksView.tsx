'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ListChecks } from 'lucide-react';
import { GeneralTaskPriority, GeneralTaskRecord, GeneralTaskStatus } from '@/lib/types';
import { GENERAL_TASK_PRIORITY_LABEL, GENERAL_TASK_PRIORITY_TONE, GENERAL_TASK_SOURCE_LABEL, GENERAL_TASK_STATUS_LABEL, GENERAL_TASK_STATUS_TONE, todayIso } from '@/lib/generalTaskLabels';
import AppShell from './AppShell';
import historyStyles from './quotationHistory.module.css';
import StatusBadge from './ui/StatusBadge';
import PriorityBadge from './ui/PriorityBadge';
import { SkeletonRows } from './ui/Skeleton';
import EmptyState from './ui/EmptyState';
import ErrorState from './ui/ErrorState';
import FilterBar from './ui/FilterBar';
import Select from './ui/Select';
import Table, { TableColumn } from './ui/Table';

function formatDate(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleDateString('en-IN');
  } catch {
    return iso;
  }
}

const OPEN_STATUSES = new Set<GeneralTaskStatus>(['pending', 'in_progress', 'under_review', 'rework_required']);

interface MyTasksViewProps {
  currentUser: { username: string; name: string };
}

export default function MyTasksView({ currentUser }: MyTasksViewProps) {
  void currentUser;
  const [tasks, setTasks] = useState<GeneralTaskRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [fStatus, setFStatus] = useState<GeneralTaskStatus | ''>('');
  const [fPriority, setFPriority] = useState<GeneralTaskPriority | ''>('');

  const today = useMemo(() => todayIso(), []);

  async function load() {
    setLoading(true);
    setLoadFailed(false);
    try {
      const response = await fetch('/api/my-tasks');
      if (!response.ok) throw new Error(String(response.status));
      setTasks(await response.json());
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    return tasks.filter((t) => (!fStatus || t.status === fStatus) && (!fPriority || t.priority === fPriority));
  }, [tasks, fStatus, fPriority]);

  const buckets = useMemo(() => {
    const overdue = filtered.filter((t) => OPEN_STATUSES.has(t.status) && t.deadline && t.deadline < today);
    const dueToday = filtered.filter((t) => OPEN_STATUSES.has(t.status) && t.deadline === today);
    const rest = filtered.filter((t) => !overdue.includes(t) && !dueToday.includes(t));
    return { overdue, dueToday, rest };
  }, [filtered, today]);

  const columns: TableColumn<GeneralTaskRecord>[] = [
    { key: 'title', header: 'Task', render: (t) => t.title },
    { key: 'source', header: 'From', render: (t) => GENERAL_TASK_SOURCE_LABEL[t.source_module] },
    { key: 'department', header: 'Department', render: (t) => t.department_name },
    { key: 'assignedBy', header: 'Assigned By', render: (t) => t.created_by },
    { key: 'priority', header: 'Priority', render: (t) => <PriorityBadge tone={GENERAL_TASK_PRIORITY_TONE[t.priority]} label={GENERAL_TASK_PRIORITY_LABEL[t.priority]} /> },
    { key: 'status', header: 'Status', render: (t) => <StatusBadge tone={GENERAL_TASK_STATUS_TONE[t.status]} label={GENERAL_TASK_STATUS_LABEL[t.status]} /> },
    { key: 'deadline', header: 'Deadline', render: (t) => formatDate(t.deadline) },
    { key: 'actions', header: '', render: (t) => <Link className={historyStyles.button} href={`/my-tasks/${t.id}`}>Open</Link> }
  ];

  if (loading) {
    return (
      <AppShell title="My Tasks" subtitle="Tasks assigned to you, from any module.">
        <div className={historyStyles.tableWrap}><SkeletonRows rows={6} columns={8} /></div>
      </AppShell>
    );
  }

  if (loadFailed) {
    return (
      <AppShell title="My Tasks" subtitle="Tasks assigned to you, from any module.">
        <ErrorState message="Could not load your tasks — check your connection and try again." onRetry={load} />
      </AppShell>
    );
  }

  return (
    <AppShell title="My Tasks" subtitle="Tasks assigned to you, from any module.">
      <FilterBar>
        <Select auto value={fStatus} onChange={(e) => setFStatus(e.target.value as GeneralTaskStatus | '')}>
          <option value="">All statuses</option>
          {(Object.keys(GENERAL_TASK_STATUS_LABEL) as GeneralTaskStatus[]).map((s) => (
            <option key={s} value={s}>{GENERAL_TASK_STATUS_LABEL[s]}</option>
          ))}
        </Select>
        <Select auto value={fPriority} onChange={(e) => setFPriority(e.target.value as GeneralTaskPriority | '')}>
          <option value="">All priorities</option>
          {(Object.keys(GENERAL_TASK_PRIORITY_LABEL) as GeneralTaskPriority[]).map((p) => (
            <option key={p} value={p}>{GENERAL_TASK_PRIORITY_LABEL[p]}</option>
          ))}
        </Select>
      </FilterBar>

      {filtered.length === 0 ? (
        <EmptyState icon={ListChecks} title="No tasks" message="Tasks assigned to you will appear here." />
      ) : (
        <>
          {buckets.overdue.length > 0 && (
            <>
              <div className={historyStyles.status} style={{ color: 'var(--mx-danger)', fontWeight: 600 }}>Overdue ({buckets.overdue.length})</div>
              <Table columns={columns} rows={buckets.overdue} rowKey={(t) => t.id} empty={null} />
            </>
          )}
          {buckets.dueToday.length > 0 && (
            <>
              <div className={historyStyles.status} style={{ color: 'var(--mx-warning)', fontWeight: 600 }}>Due Today ({buckets.dueToday.length})</div>
              <Table columns={columns} rows={buckets.dueToday} rowKey={(t) => t.id} empty={null} />
            </>
          )}
          <div className={historyStyles.status}>All Tasks</div>
          <Table columns={columns} rows={buckets.rest} rowKey={(t) => t.id} empty={null} />
        </>
      )}
    </AppShell>
  );
}
