'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, ClipboardList, Clock, ListChecks, Users } from 'lucide-react';
import { DepartmentRecord, TmsPriority, TmsProjectRecord, TmsTaskRecord, TmsTaskStatus, UserRole } from '@/lib/types';
import { TMS_DEPARTMENTS, TMS_MANAGER_TIER_ROLES } from '@/lib/tmsConstants';
import { TMS_PRIORITY_LABEL, TMS_PRIORITY_TONE, TMS_ROLE_LABEL, TMS_TASK_STATUS_LABEL, todayIso } from '@/lib/tmsLabels';
import AppShell from './AppShell';
import dashboardStyles from './dashboard.module.css';
import tmsDashboardStyles from './tmsDashboard.module.css';
import tmsTaskStyles from './tmsTasks.module.css';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import PriorityBadge from './ui/PriorityBadge';
import PersonPicker, { PersonPickerOption } from './ui/PersonPicker';
import { useToast } from './ui/ToastProvider';
import { SkeletonRows } from './ui/Skeleton';
import EmptyState from './ui/EmptyState';
import ErrorState from './ui/ErrorState';
import Modal from './ui/Modal';
import { Field, FieldRow } from './ui/Field';
import Input from './ui/Input';
import Select from './ui/Select';
import Textarea from './ui/Textarea';
import SubmitButton from './ui/SubmitButton';
import FilterBar from './ui/FilterBar';
import ToolbarButton from './ui/ToolbarButton';
import Table, { TableColumn, TableWrap } from './ui/Table';
import TmsPersonDashboard from './TmsPersonDashboard';

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

// The page was one long scroll of seven stacked sections — a manager passed
// "Your Work", Next Action, My Tasks, Team Overview, a chart and two
// near-identical assignee tables before reaching the task list they came
// for. The same content now lives behind three tabs, each answering one
// question: what's on me, how is the team doing, and where is every task.
type TaskTab = 'mine' | 'team' | 'all';

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

function formatShortDate(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  } catch {
    return iso;
  }
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const TASK_ROW_CLASS: Record<'overdue' | 'due_today' | 'upcoming', { row: string; badge: string }> = {
  overdue: { row: tmsDashboardStyles.taskRowOverdue, badge: tmsDashboardStyles.taskRowBadgeOverdue },
  due_today: { row: tmsDashboardStyles.taskRowDueToday, badge: tmsDashboardStyles.taskRowBadgeDueToday },
  upcoming: { row: tmsDashboardStyles.taskRowUpcoming, badge: tmsDashboardStyles.taskRowBadgeUpcoming }
};

// Moved here from the old TMS Dashboard (now merged into /tms/projects) along
// with every "My Work"/"Team Overview" section below — see
// ABSORBED_INTO_MERGED_PAGE in lib/moduleConfigStore.ts.
function TaskRow({ task, tone, label }: { task: TmsTaskRecord; tone: 'overdue' | 'due_today' | 'upcoming'; label: string }) {
  const t = TASK_ROW_CLASS[tone];
  return (
    <Link href={`/tms/tasks/${task.id}`} className={`${tmsDashboardStyles.taskRow} ${t.row}`}>
      <div className={tmsDashboardStyles.taskRowMain}>
        <div className={tmsDashboardStyles.taskRowTitleLine}>
          <span className={`${tmsDashboardStyles.taskRowBadge} ${t.badge}`}>{label}</span>
          <span className={tmsDashboardStyles.taskRowName}>{task.name}</span>
        </div>
        <div className={tmsDashboardStyles.taskRowProject}>Project: {task.project_name}</div>
      </div>
      <div className={tmsDashboardStyles.taskRowDue}>
        <Clock size={12} /> {tone === 'due_today' ? 'Today' : formatShortDate(task.due_date)}
      </div>
    </Link>
  );
}

interface TmsTasksViewProps {
  currentUser: { id: string; username: string; name: string; role: UserRole };
}

export default function TmsTasksView({ currentUser }: TmsTasksViewProps) {
  const isManagerTier = TMS_MANAGER_TIER_ROLES.has(currentUser.role);
  const [openPersonId, setOpenPersonId] = useState<string | null>(null);
  interface DrilldownItem { id: string; label: string; sublabel: string; href: string }
  const [drilldown, setDrilldown] = useState<{ title: string; items: DrilldownItem[] } | null>(null);
  function showTasks(title: string, items: TmsTaskRecord[]) {
    setDrilldown({ title, items: items.map((t) => ({ id: t.id, label: t.name, sublabel: [t.project_name, TMS_TASK_STATUS_LABEL[t.status]].filter(Boolean).join(' · '), href: `/tms/tasks/${t.id}` })) });
  }
  const toast = useToast();
  const [tasks, setTasks] = useState<TmsTaskRecord[]>([]);
  const [projects, setProjects] = useState<TmsProjectRecord[]>([]);
  const [departments, setDepartments] = useState<DepartmentRecord[]>([]);
  const [users, setUsers] = useState<PersonPickerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [status, setStatus] = useState('Loading...');
  // See the form initializer below — both read the same one-time deep link.
  // Opens the create MODAL now rather than an inline form that pushed the
  // whole page down as it expanded.
  const [showForm, setShowForm] = useState(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('new') === '1';
  });
  // Opened straight from a project hub: /tms/tasks?new=1&projectId=<id>, so
  // the project is already chosen and the person only fills in the task.
  // Read from window.location.search rather than useSearchParams(), which
  // would force this whole view behind a Suspense boundary for one-time
  // deep-link support — same approach, same reason, as ProjectsView.
  const [form, setForm] = useState(() => {
    if (typeof window === 'undefined') return EMPTY_FORM;
    const requested = new URLSearchParams(window.location.search).get('projectId') ?? '';
    return requested ? { ...EMPTY_FORM, projectId: requested } : EMPTY_FORM;
  });
  const [creating, setCreating] = useState(false);

  const [tab, setTab] = useState<TaskTab>('mine');
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

  // "Assign To" must only offer people from the task's own department — by
  // default that's the selected project's department (department_names
  // covers combined projects too), unless the Department field below
  // explicitly overrides it. Resolved before that field's own JSX so both
  // "Assign To" (which comes first) and "Department" agree on the same
  // effective department.
  const effectiveTaskDepartmentNames = useMemo(() => {
    if (form.departmentId) {
      const dept = tmsDepartments.find((d) => d.id === form.departmentId);
      return dept ? new Set([dept.name]) : new Set<string>();
    }
    const project = projects.find((p) => p.id === form.projectId);
    if (!project) return new Set<string>();
    return new Set(project.department_names.length ? project.department_names : [project.department_name]);
  }, [form.departmentId, form.projectId, tmsDepartments, projects]);

  const scopedUsers = useMemo(
    () => users.filter((u) => effectiveTaskDepartmentNames.has(u.department)),
    [users, effectiveTaskDepartmentNames]
  );

  // Same cleanup reasoning as TmsProjectsView.tsx: if the effective
  // department changes (project swapped, or the override changed), drop a
  // previously picked assignee who's no longer in scope.
  useEffect(() => {
    if (!form.assigneeId) return;
    if (scopedUsers.some((u) => u.id === form.assigneeId)) return;
    setForm((f) => ({ ...f, assigneeId: '' }));
  }, [scopedUsers, form.assigneeId]);

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

  // "My Work" / "Team Overview" — moved here from the old TMS Dashboard
  // verbatim (same predicates), computed off the already-loaded `tasks`
  // array so none of this needs a separate fetch. For a non-manager, `tasks`
  // is already server-scoped to "assignee or creator = me"
  // (lib/tmsTaskStore.ts), so myTasks is just a tighter assignee-only filter
  // of what's already theirs; for a manager (who sees every task), it's the
  // real personal subset.
  const myTasks = useMemo(() => tasks.filter((t) => t.assignee_id === currentUser.id), [tasks, currentUser.id]);

  const myWorkStats = useMemo(() => {
    const date = todayIso();
    const weekAgo = addDays(date, -7);
    const activeTask = (t: TmsTaskRecord) => t.status !== 'completed' && t.status !== 'cancelled';
    return {
      myTasks: myTasks.length,
      dueToday: myTasks.filter((t) => activeTask(t) && t.due_date === date).length,
      overdue: myTasks.filter((t) => activeTask(t) && t.due_date && t.due_date < date).length,
      completedThisWeek: myTasks.filter((t) => t.completion_date && t.completion_date >= weekAgo && t.completion_date <= date).length,
      myProgress: myTasks.length ? Math.round((myTasks.filter((t) => t.status === 'completed').length / myTasks.length) * 100) : null
    };
  }, [myTasks]);

  const myTaskBuckets = useMemo(() => {
    const date = todayIso();
    const activeTask = (t: TmsTaskRecord) => t.status !== 'completed' && t.status !== 'cancelled';
    const overdue = myTasks.filter((t) => activeTask(t) && t.due_date && t.due_date < date).sort((a, b) => a.due_date.localeCompare(b.due_date));
    const dueToday = myTasks.filter((t) => activeTask(t) && t.due_date === date);
    const upcoming = myTasks.filter((t) => activeTask(t) && t.due_date && t.due_date > date).sort((a, b) => a.due_date.localeCompare(b.due_date));
    return { overdue, dueToday, upcoming };
  }, [myTasks]);

  // The single most urgent thing to do next — deliberately ONE task, not a list.
  const nextAction = myTaskBuckets.overdue[0] || myTaskBuckets.dueToday[0] || null;

  // Manager Team Overview — shown only to technical-manager/team-lead/
  // privileged, who already receive the full unfiltered task pool (see
  // lib/tmsTaskStore.ts's canManageAllTmsTasks), so this is purely a
  // client-side re-grouping of data already on the page — no new API call.
  // "Active Projects" is intentionally NOT repeated here — that KPI now lives
  // on the merged /tms/projects page, which this section's own data doesn't
  // need to duplicate.
  const teamWorkload = useMemo(() => {
    if (!isManagerTier) return [];
    const byAssignee = new Map<string, { id: string; name: string; projects: Set<string>; tasks: number; overdue: number }>();
    const date = todayIso();
    tasks.forEach((t) => {
      if (!t.assignee_id) return;
      const entry = byAssignee.get(t.assignee_id) || { id: t.assignee_id, name: t.assignee_name || 'Unknown', projects: new Set<string>(), tasks: 0, overdue: 0 };
      entry.tasks += 1;
      if (t.status !== 'completed' && t.status !== 'cancelled' && t.due_date && t.due_date < date) entry.overdue += 1;
      entry.projects.add(t.project_id);
      byAssignee.set(t.assignee_id, entry);
    });
    return Array.from(byAssignee.values())
      .map((e) => ({ id: e.id, name: e.name, projectCount: e.projects.size, tasks: e.tasks, overdue: e.overdue }))
      .sort((a, b) => b.overdue - a.overdue || b.tasks - a.tasks);
  }, [isManagerTier, tasks]);

  const teamOverviewStats = useMemo(() => {
    if (!isManagerTier) return null;
    const pendingTasks = tasks.filter((t) => t.status === 'to_do' || t.status === 'in_progress' || t.status === 'on_hold');
    const date = todayIso();
    const overdueTasks = tasks.filter((t) => t.status !== 'completed' && t.status !== 'cancelled' && t.due_date && t.due_date < date);
    return {
      engineers: teamWorkload.length,
      pendingTasks: pendingTasks.length, pendingTasksItems: pendingTasks,
      overdueTasks: overdueTasks.length, overdueTasksItems: overdueTasks
    };
  }, [isManagerTier, tasks, teamWorkload]);

  const taskDistribution = useMemo(() => {
    if (!isManagerTier) return [];
    const counts = new Map<TmsTaskStatus, number>();
    tasks.forEach((t) => counts.set(t.status, (counts.get(t.status) || 0) + 1));
    const rows = (Object.keys(TMS_TASK_STATUS_LABEL) as TmsTaskStatus[])
      .map((key) => ({ key, name: TMS_TASK_STATUS_LABEL[key], count: counts.get(key) || 0 }))
      .filter((row) => row.count > 0);
    const max = rows.reduce((m, row) => Math.max(m, row.count), 0);
    // Share of the largest bar, so the bars are comparable to each other
    // rather than to the total — the question is "which status dominates".
    return rows.map((row) => ({ ...row, pct: max ? Math.round((row.count / max) * 100) : 0 }));
  }, [isManagerTier, tasks]);

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
      <div className={tmsTaskStyles.tabRow} role="tablist" aria-label="Task views">
        <button type="button" role="tab" aria-selected={tab === 'mine'} className={tab === 'mine' ? tmsTaskStyles.tabActive : tmsTaskStyles.tab} onClick={() => setTab('mine')}>
          <ListChecks size={14} /> My Work
          {myWorkStats.overdue > 0 && <span className={tmsTaskStyles.tabAlert}>{myWorkStats.overdue}</span>}
        </button>
        {isManagerTier && (
          <button type="button" role="tab" aria-selected={tab === 'team'} className={tab === 'team' ? tmsTaskStyles.tabActive : tmsTaskStyles.tab} onClick={() => setTab('team')}>
            <Users size={14} /> Team
          </button>
        )}
        <button type="button" role="tab" aria-selected={tab === 'all'} className={tab === 'all' ? tmsTaskStyles.tabActive : tmsTaskStyles.tab} onClick={() => setTab('all')}>
          <ClipboardList size={14} /> All Tasks
          <span className={tmsTaskStyles.tabCount}>{tasks.length}</span>
        </button>
        <button type="button" className={tmsTaskStyles.newBtn} onClick={() => setShowForm(true)}>+ New Task</button>
      </div>

      {tab === 'mine' && (
      <>
      <div className={historyStyles.summaryCardGrid}>
        <div className={historyStyles.summaryCard}>
          <div className={historyStyles.summaryCardLabel}>My Tasks</div>
          <div className={historyStyles.summaryCardValue}>{myWorkStats.myTasks}</div>
        </div>
        <div className={`${historyStyles.summaryCard} ${myWorkStats.dueToday ? tmsDashboardStyles.summaryCardAlertWarning : ''}`}>
          <div className={historyStyles.summaryCardLabel}>Due Today</div>
          <div className={historyStyles.summaryCardValue}>{myWorkStats.dueToday}</div>
        </div>
        <div className={`${historyStyles.summaryCard} ${myWorkStats.overdue ? tmsDashboardStyles.summaryCardAlertDanger : ''}`}>
          <div className={historyStyles.summaryCardLabel}>Overdue</div>
          <div className={historyStyles.summaryCardValue}>{myWorkStats.overdue}</div>
        </div>
        <div className={historyStyles.summaryCard}>
          <div className={historyStyles.summaryCardLabel}>Completed This Week</div>
          <div className={historyStyles.summaryCardValue}>{myWorkStats.completedThisWeek}</div>
        </div>
        {myWorkStats.myProgress !== null && (
          <div className={historyStyles.summaryCard}>
            <div className={historyStyles.summaryCardLabel}>My Progress</div>
            <div className={historyStyles.summaryCardValue}>{myWorkStats.myProgress}%</div>
          </div>
        )}
      </div>

      <div className={`${calcStyles.sectionPanel} ${tmsDashboardStyles.nextActionPanel} ${nextAction ? tmsDashboardStyles.nextActionPanelAlert : tmsDashboardStyles.nextActionPanelOk}`}>
        <div className={tmsDashboardStyles.nextActionLabel}>Next Action</div>
        {nextAction ? (
          <div className={tmsDashboardStyles.nextActionRow}>
            <div>
              <div className={tmsDashboardStyles.nextActionTitleRow}>
                <AlertTriangle size={15} color={myTaskBuckets.overdue[0] === nextAction ? 'var(--mx-danger)' : 'var(--mx-warning)'} />
                <span className={tmsDashboardStyles.nextActionTitle}>{nextAction.name}</span>
              </div>
              <div className={tmsDashboardStyles.nextActionMeta}>
                {nextAction.project_name} · {myTaskBuckets.overdue[0] === nextAction ? `Overdue — was due ${nextAction.due_date}` : 'Due today'}
              </div>
            </div>
            <Link className={calcStyles.btn} href={`/tms/tasks/${nextAction.id}`}>Open Task</Link>
          </div>
        ) : (
          <div className={tmsDashboardStyles.nextActionAllClear}>
            <CheckCircle2 size={18} /> You&apos;re all caught up. No overdue or due-today tasks.
          </div>
        )}
      </div>

      <div className={dashboardStyles.sectionHeading}>My Tasks</div>
      {myTasks.length === 0 ? (
        <EmptyState icon={ListChecks} title="No Tasks Assigned" message="You're currently all caught up." />
      ) : (
        <div className={tmsDashboardStyles.taskList}>
          {myTaskBuckets.overdue.map((t) => (
            <TaskRow key={t.id} task={t} tone="overdue" label="OVERDUE" />
          ))}
          {myTaskBuckets.dueToday.map((t) => (
            <TaskRow key={t.id} task={t} tone="due_today" label="DUE TODAY" />
          ))}
          {myTaskBuckets.upcoming.slice(0, 5).map((t) => (
            <TaskRow key={t.id} task={t} tone="upcoming" label="UPCOMING" />
          ))}
        </div>
      )}

      </>
      )}

      {tab === 'team' && isManagerTier && teamOverviewStats && (
        <>
          <div className={dashboardStyles.sectionHeading}>Team Overview</div>
          <div className={dashboardStyles.kpiGrid}>
            <div className={dashboardStyles.kpiCard}>
              <div className={dashboardStyles.kpiValue}>{teamOverviewStats.engineers}</div>
              <div className={dashboardStyles.kpiLabel}>Engineers</div>
            </div>
            <button type="button" className={`${dashboardStyles.kpiCard} ${dashboardStyles.kpiCardButton}`} onClick={() => showTasks('Pending Tasks', teamOverviewStats.pendingTasksItems)}>
              <div className={dashboardStyles.kpiValue}>{teamOverviewStats.pendingTasks}</div>
              <div className={dashboardStyles.kpiLabel}>Pending Tasks</div>
            </button>
            <button type="button" className={`${dashboardStyles.kpiCard} ${dashboardStyles.kpiCardAlert} ${dashboardStyles.kpiCardButton}`} onClick={() => showTasks('Overdue Tasks', teamOverviewStats.overdueTasksItems)}>
              <div className={dashboardStyles.kpiValue}>{teamOverviewStats.overdueTasks}</div>
              <div className={dashboardStyles.kpiLabel}>Overdue Tasks</div>
            </button>
          </div>

          {taskDistribution.length > 0 && (
            <div className={`${calcStyles.sectionPanel} ${tmsDashboardStyles.panelSpaced}`}>
              <div className={`${calcStyles.h2} ${calcStyles.h2Flush}`}>Status Distribution</div>
              {/* A labelled bar list rather than a column chart: five status
                  names collide as rotated axis labels, and every value here
                  needed a tooltip to read. Direct labels remove both
                  problems and the chart library with them. */}
              <ul className={tmsTaskStyles.statusBars}>
                {taskDistribution.map((row) => (
                  <li key={row.key} className={tmsTaskStyles.statusBarRow}>
                    <span className={tmsTaskStyles.statusBarLabel}>{row.name}</span>
                    <span className={tmsTaskStyles.statusBarTrack}>
                      <span className={tmsTaskStyles.statusBarFill} style={{ width: `${row.pct}%` }} />
                    </span>
                    <span className={tmsTaskStyles.statusBarValue}>{row.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {teamWorkload.length > 0 && (
            <div className={`${calcStyles.sectionPanel} ${tmsDashboardStyles.panelSpaced}`}>
              <div className={`${calcStyles.h2} ${calcStyles.h2Flush}`}>Team Workload</div>
              <TableWrap>
                <table className={historyStyles.table}>
                  <thead><tr><th>Engineer</th><th>Projects</th><th>Tasks</th><th>Overdue</th><th></th></tr></thead>
                  <tbody>
                    {teamWorkload.map((w) => (
                      <tr key={w.id} className={tmsDashboardStyles.clickableRow} onClick={() => setFAssignee((v) => (v === w.id ? '' : w.id))}>
                        <td className={fAssignee === w.id ? tmsDashboardStyles.rowHighlight : undefined}>{w.name}</td>
                        <td>{w.projectCount}</td>
                        <td>{w.tasks}</td>
                        <td className={w.overdue ? tmsDashboardStyles.overdueCount : undefined}>{w.overdue}</td>
                        <td>
                          <button
                            type="button"
                            className={historyStyles.button}
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenPersonId(w.id);
                            }}
                          >
                            Profile
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </div>
          )}
        </>
      )}

      {tab === 'all' && (
      <>
      <div className={historyStyles.actionRow}>
        {/* "+ New Task" lives in the tab bar now — one button, always in
            the same place, instead of one here plus another inside the
            table's empty state. */}
        <ToolbarButton onClick={load}>Refresh</ToolbarButton>
        <span className={historyStyles.verticalDivider} />
        <ToolbarButton primary={viewMode === 'daily'} onClick={() => setViewMode('daily')}>
          Daily View
        </ToolbarButton>
        <ToolbarButton primary={viewMode === 'all'} onClick={() => setViewMode('all')}>
          All Tasks
        </ToolbarButton>
      </div>

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
              action={<button type="button" className={calcStyles.btn} onClick={() => setShowForm(true)}>+ New Task</button>}
            />
          }
        />
      )}

      </>
      )}

      {showForm && (
        <Modal
          title="New Task"
          ariaLabel="Create a task"
          size="wide"
          onClose={() => setShowForm(false)}
        >
          {/* Was an inline panel that expanded in the middle of the page and
              pushed the filters and the whole table down as it opened. */}
          <form onSubmit={handleCreate}>
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
              options={scopedUsers}
              selectedIds={form.assigneeId ? [form.assigneeId] : []}
              onChange={(ids) => setForm((f) => ({ ...f, assigneeId: ids[0] || '' }))}
              placeholder="Search engineer…"
              roleLabel={(role) => TMS_ROLE_LABEL[role] || role}
              emptyMessage={
                effectiveTaskDepartmentNames.size
                  ? 'No matching active Technical Team members found in this department.'
                  : 'Select a project (or department below) first.'
              }
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
        </Modal>
      )}

      {drilldown && (
        <Modal title={drilldown.title} ariaLabel={drilldown.title} onClose={() => setDrilldown(null)}>
          {drilldown.items.length === 0 ? (
            <p className={calcStyles.small}>Nothing in this bucket.</p>
          ) : (
            <ul className={tmsDashboardStyles.drilldownList}>
              {drilldown.items.map((item) => (
                <li key={item.id}>
                  <Link href={item.href} className={tmsDashboardStyles.drilldownRow} onClick={() => setDrilldown(null)}>
                    <span className={tmsDashboardStyles.drilldownLabel}>{item.label}</span>
                    <span className={tmsDashboardStyles.drilldownSublabel}>{item.sublabel}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}

      {openPersonId && <TmsPersonDashboard userId={openPersonId} onClose={() => setOpenPersonId(null)} />}
    </AppShell>
  );
}
