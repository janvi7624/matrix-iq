'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ClipboardList } from 'lucide-react';
import { DepartmentRecord, GeneralTaskPriority, GeneralTaskRecord, HrTaskCategoryRecord } from '@/lib/types';
import { GENERAL_TASK_PRIORITY_LABEL, GENERAL_TASK_PRIORITY_TONE, GENERAL_TASK_STATUS_LABEL, GENERAL_TASK_STATUS_TONE, todayIso } from '@/lib/generalTaskLabels';
import AppShell from './AppShell';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import detailStyles from './tmsDetail.module.css';
import StatusBadge from './ui/StatusBadge';
import PriorityBadge from './ui/PriorityBadge';
import { useToast } from './ui/ToastProvider';
import EmptyState from './ui/EmptyState';
import ErrorState from './ui/ErrorState';
import { SkeletonRows } from './ui/Skeleton';
import { Field, FieldRow } from './ui/Field';
import Input from './ui/Input';
import Select from './ui/Select';
import Textarea from './ui/Textarea';
import SubmitButton from './ui/SubmitButton';
import ToolbarButton from './ui/ToolbarButton';
import Table, { TableColumn } from './ui/Table';
import ActivityTimeline from './ui/ActivityTimeline';

interface EmployeeOption {
  id: string;
  username: string;
  name: string;
  designation: string;
}

const EMPTY_FORM = {
  departmentId: '',
  assigneeId: '',
  title: '',
  description: '',
  priority: 'medium' as GeneralTaskPriority,
  deadline: '',
  categoryId: '',
  remarks: '',
  requiresReview: true
};

const TABS = [
  { key: 'daily', label: 'Daily Tasks' },
  { key: 'assign', label: 'Assign Task' },
  { key: 'mine', label: 'My HR Tasks' },
  { key: 'review', label: 'Review Queue' },
  { key: 'activity', label: 'Activity' }
] as const;
type TabKey = (typeof TABS)[number]['key'];

function formatDate(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleDateString('en-IN');
  } catch {
    return iso;
  }
}

interface HrTasksViewProps {
  currentUser: { username: string; name: string; isHrManager: boolean };
}

export default function HrTasksView({ currentUser }: HrTasksViewProps) {
  const toast = useToast();
  const [tab, setTab] = useState<TabKey>('daily');
  const [tasks, setTasks] = useState<GeneralTaskRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [departments, setDepartments] = useState<DepartmentRecord[]>([]);
  const [categories, setCategories] = useState<HrTaskCategoryRecord[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);

  const today = useMemo(() => todayIso(), []);

  async function load() {
    setLoading(true);
    setLoadFailed(false);
    try {
      const [tasksRes, deptRes, catRes] = await Promise.all([fetch('/api/hr/tasks'), fetch('/api/departments'), fetch('/api/hr/categories')]);
      if (!tasksRes.ok) throw new Error(String(tasksRes.status));
      setTasks(await tasksRes.json());
      if (deptRes.ok) setDepartments(await deptRes.json());
      if (catRes.ok) setCategories(await catRes.json());
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!form.departmentId) {
      setEmployees([]);
      return;
    }
    setLoadingEmployees(true);
    fetch(`/api/departments/${form.departmentId}/active-employees`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setEmployees)
      .catch(() => setEmployees([]))
      .finally(() => setLoadingEmployees(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.departmentId]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return toast.error('Task title is required.');
    if (!form.departmentId || !form.assigneeId) return toast.error('Department and employee are required.');
    if (!form.deadline) return toast.error('Deadline is required.');

    setCreating(true);
    try {
      const response = await fetch('/api/hr/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || String(response.status));
      }
      setForm(EMPTY_FORM);
      setEmployees([]);
      await load();
      setTab('mine');
      toast.success('HR task assigned.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not assign this task.');
    } finally {
      setCreating(false);
    }
  }

  const dailyTasks = useMemo(() => tasks.filter((t) => t.deadline === today), [tasks, today]);
  const myTasks = useMemo(() => tasks.filter((t) => t.assignee_username === currentUser.username), [tasks, currentUser.username]);
  const reviewQueue = useMemo(() => tasks.filter((t) => t.status === 'under_review'), [tasks]);

  const columns: TableColumn<GeneralTaskRecord>[] = [
    { key: 'title', header: 'Task', render: (t) => t.title },
    { key: 'assignee', header: 'Assignee', render: (t) => t.assignee_name },
    { key: 'category', header: 'Category', render: (t) => t.category || '-' },
    { key: 'priority', header: 'Priority', render: (t) => <PriorityBadge tone={GENERAL_TASK_PRIORITY_TONE[t.priority]} label={GENERAL_TASK_PRIORITY_LABEL[t.priority]} /> },
    { key: 'status', header: 'Status', render: (t) => <StatusBadge tone={GENERAL_TASK_STATUS_TONE[t.status]} label={GENERAL_TASK_STATUS_LABEL[t.status]} /> },
    { key: 'deadline', header: 'Deadline', render: (t) => formatDate(t.deadline) },
    { key: 'actions', header: '', render: (t) => <Link className={historyStyles.button} href={`/my-tasks/${t.id}`}>Open</Link> }
  ];

  if (loading) {
    return (
      <AppShell title="HR Tasks" subtitle="Daily tasks, assignment, submission, and review for the HR team.">
        <div className={historyStyles.tableWrap}><SkeletonRows rows={6} columns={7} /></div>
      </AppShell>
    );
  }
  if (loadFailed) {
    return (
      <AppShell title="HR Tasks" subtitle="Daily tasks, assignment, submission, and review for the HR team.">
        <ErrorState message="Could not load HR tasks — check your connection and try again." onRetry={load} />
      </AppShell>
    );
  }

  return (
    <AppShell title="HR Tasks" subtitle="Daily tasks, assignment, submission, and review for the HR team.">
      <div className={detailStyles.tabRow}>
        {TABS.map((t) => (
          <ToolbarButton key={t.key} primary={tab === t.key} onClick={() => setTab(t.key)}>{t.label}</ToolbarButton>
        ))}
      </div>

      {tab === 'daily' && (
        dailyTasks.length === 0 ? (
          <EmptyState icon={ClipboardList} title="No tasks due today" message="HR tasks due today will appear here." />
        ) : (
          <Table columns={columns} rows={dailyTasks} rowKey={(t) => t.id} empty={null} />
        )
      )}

      {tab === 'assign' && (
        currentUser.isHrManager ? (
          <form className={`${calcStyles.sectionPanel} ${calcStyles.sectionPanelSpaced}`} onSubmit={handleCreate}>
            <FieldRow>
              <Field label="Department">
                <Select value={form.departmentId} onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value, assigneeId: '' }))} required>
                  <option value="">Select department</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Employee">
                <Select value={form.assigneeId} onChange={(e) => setForm((f) => ({ ...f, assigneeId: e.target.value }))} required disabled={!form.departmentId || loadingEmployees}>
                  <option value="">{loadingEmployees ? 'Loading…' : 'Select employee'}</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>{emp.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Category">
                <Select value={form.categoryId} onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}>
                  <option value="">No category</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </Select>
              </Field>
            </FieldRow>
            <Field label="Task Title">
              <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} required />
            </Field>
            <Field label="Description / Instructions">
              <Textarea rows={3} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </Field>
            <FieldRow>
              <Field label="Priority">
                <Select value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as GeneralTaskPriority }))}>
                  {(Object.keys(GENERAL_TASK_PRIORITY_LABEL) as GeneralTaskPriority[]).map((p) => (
                    <option key={p} value={p}>{GENERAL_TASK_PRIORITY_LABEL[p]}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Deadline">
                <Input type="date" min={today} value={form.deadline} onChange={(e) => setForm((f) => ({ ...f, deadline: e.target.value }))} required />
              </Field>
              <Field label="Requires Review">
                <Select value={form.requiresReview ? 'yes' : 'no'} onChange={(e) => setForm((f) => ({ ...f, requiresReview: e.target.value === 'yes' }))}>
                  <option value="yes">Yes</option>
                  <option value="no">No — auto-complete on submission</option>
                </Select>
              </Field>
            </FieldRow>
            <Field label="Remarks">
              <Textarea rows={2} value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} />
            </Field>
            <SubmitButton disabled={creating}>{creating ? 'Assigning…' : 'Assign HR Task'}</SubmitButton>
          </form>
        ) : (
          <div className={historyStyles.status}>Only an HR manager or admin can assign new HR tasks. You can still view and work your own tasks.</div>
        )
      )}

      {tab === 'mine' && (
        myTasks.length === 0 ? (
          <EmptyState icon={ClipboardList} title="No HR tasks" message="HR tasks in your visibility scope will appear here." />
        ) : (
          <Table columns={columns} rows={myTasks} rowKey={(t) => t.id} empty={null} />
        )
      )}

      {tab === 'review' && (
        reviewQueue.length === 0 ? (
          <EmptyState icon={ClipboardList} title="Nothing to review" message="Tasks submitted for review will appear here." />
        ) : (
          <Table columns={columns} rows={reviewQueue} rowKey={(t) => t.id} empty={null} />
        )
      )}

      {tab === 'activity' && (
        <ActivityTimelineFromTasks tasks={tasks} />
      )}
    </AppShell>
  );
}

// Lightweight synthetic activity feed from the already-fetched task list
// (status/deadline changes) rather than a second API call — a real
// per-task audit trail is already on each task's own detail page.
function ActivityTimelineFromTasks({ tasks }: { tasks: GeneralTaskRecord[] }) {
  const entries = [...tasks]
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, 30)
    .map((t) => ({ id: t.id, label: `${t.title} — ${GENERAL_TASK_STATUS_LABEL[t.status]}`, by: t.assignee_name, at: t.updated_at }));
  return <ActivityTimeline entries={entries} empty="No recent HR task activity." />;
}
