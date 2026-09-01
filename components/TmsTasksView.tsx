'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ClipboardList } from 'lucide-react';
import { DepartmentRecord, TmsPriority, TmsProjectRecord, TmsTaskRecord, TmsTaskStatus, UserRole } from '@/lib/types';
import { TMS_DEPARTMENTS } from '@/lib/tmsConstants';
import { TMS_PRIORITY_LABEL, TMS_PRIORITY_TONE, TMS_ROLE_LABEL, TMS_TASK_STATUS_LABEL, todayIso } from '@/lib/tmsLabels';
import AppShell from './AppShell';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import PriorityBadge from './ui/PriorityBadge';
import PersonPicker, { PersonPickerOption } from './ui/PersonPicker';
import { useToast } from './ui/ToastProvider';
import { SkeletonRows } from './ui/Skeleton';
import EmptyState from './ui/EmptyState';
import ErrorState from './ui/ErrorState';
import { Field, FieldRow } from './ui/Field';
import Input from './ui/Input';
import Select from './ui/Select';
import Textarea from './ui/Textarea';
import SubmitButton from './ui/SubmitButton';
import FilterBar from './ui/FilterBar';
import ToolbarButton from './ui/ToolbarButton';
import Table, { TableColumn } from './ui/Table';

const EMPTY_FORM = {
  name: '',
  projectId: '',
  assigneeId: '',
  departmentId: '',
  description: '',
  priority: 'medium' as TmsPriority,
  startDate: '',
  dueDate: '',
  remarks: ''
};

type ViewMode = 'daily' | 'all';
type SortKey = 'due_date' | 'priority' | 'created';
type DailyBucket = 'today' | 'due_today' | 'overdue' | 'completed_today' | 'pending';

const PRIORITY_RANK: Record<TmsPriority, number> = { high: 0, medium: 1, low: 2 };

function formatDate(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleDateString('en-IN');
  } catch {
    return iso;
  }
}

interface TmsTasksViewProps {
  currentUser: { username: string; role: UserRole };
}

export default function TmsTasksView({ currentUser }: TmsTasksViewProps) {
  void currentUser;
  const toast = useToast();
  const [tasks, setTasks] = useState<TmsTaskRecord[]>([]);
  const [projects, setProjects] = useState<TmsProjectRecord[]>([]);
  const [departments, setDepartments] = useState<DepartmentRecord[]>([]);
  const [users, setUsers] = useState<PersonPickerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [status, setStatus] = useState('Loading...');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);

  const [viewMode, setViewMode] = useState<ViewMode>('daily');
  const [dailyBucket, setDailyBucket] = useState<DailyBucket>('today');
  const [fDate, setFDate] = useState(todayIso());
  const [fProject, setFProject] = useState('');
  const [fDepartment, setFDepartment] = useState('');
  const [fAssignee, setFAssignee] = useState('');
  const [fStatus, setFStatus] = useState<TmsTaskStatus | ''>('');
  const [fPriority, setFPriority] = useState<TmsPriority | ''>('');
  const [sortKey, setSortKey] = useState<SortKey>('due_date');

  const tmsDepartments = useMemo(
    () => departments.filter((d) => (TMS_DEPARTMENTS as readonly string[]).includes(d.name)).sort((a, b) => a.name.localeCompare(b.name)),
    [departments]
  );

  async function load() {
    setStatus('Loading...');
    setLoading(true);
    setLoadFailed(false);
    try {
      const [tasksRes, projectsRes, deptRes, usersRes] = await Promise.all([
        fetch('/api/tms/tasks'),
        fetch('/api/tms/projects'),
        fetch('/api/departments'),
        fetch('/api/tms/assignable-users')
      ]);
      if (!tasksRes.ok) throw new Error(String(tasksRes.status));
      const data: TmsTaskRecord[] = await tasksRes.json();
      setTasks(data);
      if (projectsRes.ok) setProjects(await projectsRes.json());
      if (deptRes.ok) setDepartments(await deptRes.json());
      if (usersRes.ok) setUsers(await usersRes.json());
      setStatus(data.length ? `${data.length} task${data.length === 1 ? '' : 's'} found.` : '');
    } catch {
      setStatus('Could not reach the TMS API. Try refreshing.');
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      if (fProject && t.project_id !== fProject) return false;
      if (fDepartment && t.department_name !== fDepartment) return false;
      if (fAssignee && t.assignee_id !== fAssignee) return false;
      if (fStatus && t.status !== fStatus) return false;
      if (fPriority && t.priority !== fPriority) return false;
      return true;
    });
  }, [tasks, fProject, fDepartment, fAssignee, fStatus, fPriority]);

  const dailyBuckets = useMemo(() => {
    const date = fDate || todayIso();
    const active = (t: TmsTaskRecord) => t.status !== 'completed' && t.status !== 'cancelled';
    return {
      today: filtered.filter((t) => active(t) && t.start_date && t.start_date <= date && (!t.due_date || t.due_date >= date)),
      due_today: filtered.filter((t) => active(t) && t.due_date === date),
      overdue: filtered.filter((t) => active(t) && t.due_date && t.due_date < date),
      completed_today: filtered.filter((t) => t.completion_date === date),
      pending: filtered.filter((t) => t.status === 'to_do' || t.status === 'in_progress' || t.status === 'on_hold')
    };
  }, [filtered, fDate]);

  const dailyRows = viewMode === 'daily' ? dailyBuckets[dailyBucket] : filtered;

  const sortedRows = useMemo(() => {
    const rows = [...dailyRows];
    if (sortKey === 'due_date') rows.sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'));
    else if (sortKey === 'priority') rows.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
    else rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    return rows;
  }, [dailyRows, sortKey]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.projectId) {
      toast.error('Task name and project are required.');
      return;
    }
    setCreating(true);
    try {
      const response = await fetch('/api/tms/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || String(response.status));
      }
      setForm(EMPTY_FORM);
      setShowForm(false);
      await load();
      toast.success('Task created.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create this task.');
    } finally {
      setCreating(false);
    }
  }

  async function handleStatusChange(task: TmsTaskRecord, next: TmsTaskStatus) {
    try {
      const response = await fetch(`/api/tms/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next })
      });
      if (!response.ok) throw new Error(String(response.status));
      await load();
    } catch {
      toast.error('Could not update task status.');
    }
  }

  const bucketLabel: Record<DailyBucket, string> = {
    today: "Today's Tasks",
    due_today: 'Due Today',
    overdue: 'Overdue',
    completed_today: 'Completed Today',
    pending: 'Pending'
  };

  const columns: TableColumn<TmsTaskRecord>[] = [
    { key: 'name', header: 'Task', render: (t) => t.name },
    { key: 'project', header: 'Project', render: (t) => t.project_name },
    { key: 'department', header: 'Department', render: (t) => t.department_name || '-' },
    { key: 'assignee', header: 'Assignee', render: (t) => t.assignee_name || 'Unassigned' },
    { key: 'dueDate', header: 'Due Date', render: (t) => formatDate(t.due_date) },
    { key: 'priority', header: 'Priority', render: (t) => <PriorityBadge tone={TMS_PRIORITY_TONE[t.priority]} label={TMS_PRIORITY_LABEL[t.priority]} /> },
    {
      key: 'status',
      header: 'Status',
      render: (t) => (
        <Select auto value={t.status} onChange={(e) => handleStatusChange(t, e.target.value as TmsTaskStatus)}>
          {(Object.keys(TMS_TASK_STATUS_LABEL) as TmsTaskStatus[]).map((s) => (
            <option key={s} value={s}>{TMS_TASK_STATUS_LABEL[s]}</option>
          ))}
        </Select>
      )
    },
    { key: 'actions', header: '', render: (t) => <Link className={historyStyles.button} href={`/tms/tasks/${t.id}`}>View</Link> }
  ];

  return (
    <AppShell title="TMS Tasks" subtitle="Day-by-day task planning and completion — no time tracking.">
      <div className={historyStyles.actionRow}>
        <button type="button" className={calcStyles.btn} onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Cancel' : '+ New Task'}
        </button>
        <ToolbarButton onClick={load}>Refresh</ToolbarButton>
        <span className={historyStyles.verticalDivider} />
        <ToolbarButton primary={viewMode === 'daily'} onClick={() => setViewMode('daily')}>
          Daily View
        </ToolbarButton>
        <ToolbarButton primary={viewMode === 'all'} onClick={() => setViewMode('all')}>
          All Tasks
        </ToolbarButton>
      </div>

      {showForm && (
        <form className={`${calcStyles.sectionPanel} ${calcStyles.sectionPanelSpaced}`} onSubmit={handleCreate}>
          <FieldRow>
            <Field label="Task Name — What needs to be done?">
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
            </Field>
            <Field label="Project — Which project is this for?">
              <Select value={form.projectId} onChange={(e) => setForm((f) => ({ ...f, projectId: e.target.value }))} required>
                <option value="">Select project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.project_code} — {p.name}</option>
                ))}
              </Select>
            </Field>
          </FieldRow>
          <Field label="Assign To — Who will do this?">
            <PersonPicker
              options={users}
              selectedIds={form.assigneeId ? [form.assigneeId] : []}
              onChange={(ids) => setForm((f) => ({ ...f, assigneeId: ids[0] || '' }))}
              placeholder="Search engineer…"
              roleLabel={(role) => TMS_ROLE_LABEL[role] || role}
              emptyMessage="No matching active Technical Team members found."
            />
          </Field>
          <FieldRow>
            <Field label="Department">
              <Select value={form.departmentId} onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))}>
                <option value="">Same as project</option>
                {tmsDepartments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Priority">
              <Select value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as TmsPriority }))}>
                {(Object.keys(TMS_PRIORITY_LABEL) as TmsPriority[]).map((p) => (
                  <option key={p} value={p}>{TMS_PRIORITY_LABEL[p]}</option>
                ))}
              </Select>
            </Field>
            <Field label="Start date">
              <Input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
            </Field>
            <Field label="Due Date *">
              <Input type="date" value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} />
            </Field>
          </FieldRow>
          <Field label="Description — Explain the work required.">
            <Textarea rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </Field>
          <SubmitButton disabled={creating}>{creating ? 'Creating…' : 'Create task'}</SubmitButton>
        </form>
      )}

      {viewMode === 'daily' && (
        <div className={historyStyles.bucketRow}>
          {(Object.keys(bucketLabel) as DailyBucket[]).map((key) => (
            <ToolbarButton
              key={key}
              primary={dailyBucket === key}
              onClick={() => setDailyBucket(key)}
            >
              {bucketLabel[key]} ({dailyBuckets[key].length})
            </ToolbarButton>
          ))}
        </div>
      )}

      <FilterBar>
        {viewMode === 'daily' && <Input auto type="date" value={fDate} onChange={(e) => setFDate(e.target.value)} />}
        <Select auto value={fProject} onChange={(e) => setFProject(e.target.value)}>
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </Select>
        <Select auto value={fDepartment} onChange={(e) => setFDepartment(e.target.value)}>
          <option value="">All departments</option>
          {TMS_DEPARTMENTS.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </Select>
        <Select auto value={fAssignee} onChange={(e) => setFAssignee(e.target.value)}>
          <option value="">All assignees</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.name || u.username}</option>
          ))}
        </Select>
        <Select auto value={fStatus} onChange={(e) => setFStatus(e.target.value as TmsTaskStatus | '')}>
          <option value="">All statuses</option>
          {(Object.keys(TMS_TASK_STATUS_LABEL) as TmsTaskStatus[]).map((s) => (
            <option key={s} value={s}>{TMS_TASK_STATUS_LABEL[s]}</option>
          ))}
        </Select>
        <Select auto value={fPriority} onChange={(e) => setFPriority(e.target.value as TmsPriority | '')}>
          <option value="">All priorities</option>
          {(Object.keys(TMS_PRIORITY_LABEL) as TmsPriority[]).map((p) => (
            <option key={p} value={p}>{TMS_PRIORITY_LABEL[p]}</option>
          ))}
        </Select>
        <Select auto value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
          <option value="due_date">Sort: Due Date</option>
          <option value="priority">Sort: Priority</option>
          <option value="created">Sort: Created</option>
        </Select>
      </FilterBar>
      {!loading && !loadFailed && <div className={historyStyles.status}>{status}</div>}

      {loading ? (
        <div className={historyStyles.tableWrap}><SkeletonRows rows={8} columns={7} /></div>
      ) : loadFailed ? (
        <ErrorState message="Could not load TMS tasks — check your connection and try again." onRetry={load} />
      ) : (
        <Table
          columns={columns}
          rows={sortedRows}
          rowKey={(t) => t.id}
          empty={
            <EmptyState
              icon={ClipboardList}
              title={tasks.length === 0 ? 'No Tasks Assigned' : 'No tasks here'}
              message={tasks.length === 0 ? "You're currently all caught up." : 'Nothing matches this view — try a different bucket or filter.'}
            />
          }
        />
      )}
    </AppShell>
  );
}
