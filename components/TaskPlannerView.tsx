'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Plus, Search, X, KanbanSquare, ChevronDown } from 'lucide-react';
import { DepartmentRecord, GeneralTaskPriority, GeneralTaskRecord, GeneralTaskStatus, ProjectRecord, TmsProjectRecord, UserRole } from '@/lib/types';
import { GENERAL_TASK_PRIORITY_LABEL, GENERAL_TASK_PRIORITY_TONE, GENERAL_TASK_STATUS_LABEL, GENERAL_TASK_STATUS_TONE, todayIso } from '@/lib/generalTaskLabels';
import AppShell from './AppShell';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import detailStyles from './tmsDetail.module.css';
import planner from './taskPlanner.module.css';
import StatusBadge from './ui/StatusBadge';
import PriorityBadge from './ui/PriorityBadge';
import { useToast } from './ui/ToastProvider';
import { SkeletonRows } from './ui/Skeleton';
import EmptyState from './ui/EmptyState';
import ErrorState from './ui/ErrorState';
import { Field, FieldRow } from './ui/Field';
import Input from './ui/Input';
import Select from './ui/Select';
import Textarea from './ui/Textarea';
import ToolbarButton from './ui/ToolbarButton';
import SubmitButton from './ui/SubmitButton';
import Table, { TableColumn } from './ui/Table';
import Drawer from './ui/Drawer';
import Modal, { ModalCancelButton, ModalOkButton } from './ui/Modal';
import GeneralTaskDetailPanel from './GeneralTaskDetailPanel';

interface EmployeeOption {
  id: string;
  username: string;
  name: string;
  designation: string;
}
interface ManagerOption {
  id: string;
  username: string;
  name: string;
}

type AssignTarget = 'employee' | 'department';
type AssignMode = 'employee' | 'selected' | 'department' | 'manager' | 'unassigned';

const EMPTY_FORM = {
  departmentId: '',
  assignTarget: 'employee' as AssignTarget,
  assignMode: 'employee' as AssignMode,
  assigneeId: '',
  assigneeIds: [] as string[],
  title: '',
  description: '',
  priority: 'medium' as GeneralTaskPriority,
  startDate: '',
  deadline: '',
  category: '',
  projectId: '',
  tmsProjectId: '',
  remarks: '',
  requiresReview: true
};

const KPI_DEFS: { key: string; label: string; danger?: boolean; warning?: boolean }[] = [
  { key: 'total', label: 'Total Tasks' },
  { key: 'pending', label: 'Not Started' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'rework_required', label: 'Rework Required', warning: true },
  { key: 'under_review', label: 'Under Review' },
  { key: 'done', label: 'Completed' },
  { key: 'overdue', label: 'Overdue', danger: true },
  { key: 'due_today', label: 'Due Today', warning: true }
];

// Board columns are the real GeneralTaskStatus values, grouped a little for
// readability — there is no "Blocked" status on GeneralTask (see the plan's
// own audit note); "Rework Required" is the real state that means the same
// thing (stuck, waiting on the employee), not a fabricated new one.
const BOARD_COLUMNS: { key: string; label: string; statuses: GeneralTaskStatus[] }[] = [
  { key: 'pending', label: 'Not Started', statuses: ['pending'] },
  { key: 'in_progress', label: 'In Progress', statuses: ['in_progress'] },
  { key: 'under_review', label: 'Under Review', statuses: ['under_review'] },
  { key: 'rework_required', label: 'Rework Required', statuses: ['rework_required'] },
  { key: 'done', label: 'Completed', statuses: ['completed', 'approved'] },
  { key: 'closed', label: 'Rejected / Cancelled', statuses: ['rejected', 'cancelled'] }
];

const GROUP_OPTIONS = [
  { key: 'none', label: 'No Grouping' },
  { key: 'status', label: 'Status' },
  { key: 'department', label: 'Department' },
  { key: 'assignee', label: 'Assigned To' },
  { key: 'priority', label: 'Priority' },
  { key: 'category', label: 'Category' }
] as const;
type GroupKey = (typeof GROUP_OPTIONS)[number]['key'];

interface Filters {
  departmentId: string;
  assigneeUsername: string;
  status: GeneralTaskStatus | '';
  priority: GeneralTaskPriority | '';
  category: string;
  overdue: boolean;
  dueToday: boolean;
}
const EMPTY_FILTERS: Filters = { departmentId: '', assigneeUsername: '', status: '', priority: '', category: '', overdue: false, dueToday: false };

function formatDate(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleDateString('en-IN');
  } catch {
    return iso;
  }
}

const OPEN_STATUSES = new Set<GeneralTaskStatus>(['pending', 'in_progress', 'under_review', 'rework_required']);

function isOverdue(t: GeneralTaskRecord, today: string): boolean {
  return OPEN_STATUSES.has(t.status) && !!t.deadline && t.deadline < today;
}
function isDueToday(t: GeneralTaskRecord, today: string): boolean {
  return OPEN_STATUSES.has(t.status) && t.deadline === today;
}

interface TaskPlannerViewProps {
  currentUser: { username: string; name: string; role: UserRole; isPrivileged: boolean };
}

export default function TaskPlannerView({ currentUser }: TaskPlannerViewProps) {
  const toast = useToast();
  const today = useMemo(() => todayIso(), []);

  const [tasks, setTasks] = useState<GeneralTaskRecord[]>([]);
  const [departments, setDepartments] = useState<DepartmentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [view, setView] = useState<'board' | 'list'>('board');
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [search, setSearch] = useState('');
  const [groupBy, setGroupBy] = useState<GroupKey>('none');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [transitionPrompt, setTransitionPrompt] = useState<{ taskId: string; kind: 'submit' | 'approve' | 'rework' | 'reject' | 'start' | 'reopen' } | null>(null);
  const [transitionText, setTransitionText] = useState('');
  const [transitionBusy, setTransitionBusy] = useState(false);

  async function load() {
    setLoading(true);
    setLoadFailed(false);
    try {
      const [tasksRes, deptRes] = await Promise.all([fetch('/api/admin/task-assignment'), fetch('/api/departments')]);
      if (!tasksRes.ok) throw new Error(String(tasksRes.status));
      setTasks(await tasksRes.json());
      if (deptRes.ok) setDepartments(await deptRes.json());
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const kpis = useMemo(() => {
    const values: Record<string, number> = { total: tasks.length, pending: 0, in_progress: 0, rework_required: 0, under_review: 0, done: 0, overdue: 0, due_today: 0 };
    for (const t of tasks) {
      if (t.status === 'pending') values.pending++;
      else if (t.status === 'in_progress') values.in_progress++;
      else if (t.status === 'rework_required') values.rework_required++;
      else if (t.status === 'under_review') values.under_review++;
      else if (t.status === 'completed' || t.status === 'approved') values.done++;
      if (isOverdue(t, today)) values.overdue++;
      if (isDueToday(t, today)) values.due_today++;
    }
    return values;
  }, [tasks, today]);

  const [activeKpi, setActiveKpi] = useState<string | null>(null);
  function toggleKpi(key: string) {
    if (activeKpi === key) {
      setActiveKpi(null);
      setFilters(EMPTY_FILTERS);
      return;
    }
    setActiveKpi(key);
    const base = { ...EMPTY_FILTERS };
    if (key === 'overdue') setFilters({ ...base, overdue: true });
    else if (key === 'due_today') setFilters({ ...base, dueToday: true });
    else if (key === 'pending' || key === 'in_progress' || key === 'rework_required' || key === 'under_review') setFilters({ ...base, status: key as GeneralTaskStatus });
    else setFilters(base);
  }

  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter((t) => {
      if (filters.departmentId && t.department_id !== filters.departmentId) return false;
      if (filters.assigneeUsername && t.assignee_username !== filters.assigneeUsername) return false;
      if (filters.status && t.status !== filters.status) return false;
      if (filters.priority && t.priority !== filters.priority) return false;
      if (filters.category && t.category !== filters.category) return false;
      if (filters.overdue && !isOverdue(t, today)) return false;
      if (filters.dueToday && !isDueToday(t, today)) return false;
      if (q) {
        const haystack = `${t.title} ${t.description} ${t.assignee_name} ${t.department_name} ${t.project_name} ${t.category} ${t.id}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [tasks, filters, search, today]);

  const activeChips = useMemo(() => {
    const chips: { key: string; label: string }[] = [];
    if (filters.departmentId) chips.push({ key: 'departmentId', label: departments.find((d) => d.id === filters.departmentId)?.name || 'Department' });
    if (filters.assigneeUsername) chips.push({ key: 'assigneeUsername', label: tasks.find((t) => t.assignee_username === filters.assigneeUsername)?.assignee_name || filters.assigneeUsername });
    if (filters.status) chips.push({ key: 'status', label: GENERAL_TASK_STATUS_LABEL[filters.status] });
    if (filters.priority) chips.push({ key: 'priority', label: GENERAL_TASK_PRIORITY_LABEL[filters.priority] });
    if (filters.category) chips.push({ key: 'category', label: filters.category });
    if (filters.overdue) chips.push({ key: 'overdue', label: 'Overdue' });
    if (filters.dueToday) chips.push({ key: 'dueToday', label: 'Due Today' });
    return chips;
  }, [filters, departments, tasks]);

  function removeChip(key: string) {
    setActiveKpi(null);
    setFilters((f) => ({ ...f, [key]: key === 'overdue' || key === 'dueToday' ? false : '' }));
  }
  function clearAllFilters() {
    setActiveKpi(null);
    setFilters(EMPTY_FILTERS);
  }

  const categories = useMemo(() => Array.from(new Set(tasks.map((t) => t.category).filter(Boolean))).sort(), [tasks]);

  function groupLabelFor(t: GeneralTaskRecord): string {
    if (groupBy === 'status') return GENERAL_TASK_STATUS_LABEL[t.status];
    if (groupBy === 'department') return t.department_name || 'No Department';
    if (groupBy === 'assignee') return t.assignee_name || 'Unassigned';
    if (groupBy === 'priority') return GENERAL_TASK_PRIORITY_LABEL[t.priority];
    if (groupBy === 'category') return t.category || 'No Category';
    return '';
  }

  const groupedForList = useMemo(() => {
    if (groupBy === 'none') return [{ label: '', rows: filteredTasks }];
    const map = new Map<string, GeneralTaskRecord[]>();
    for (const t of filteredTasks) {
      const key = groupLabelFor(t);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return Array.from(map.entries()).map(([label, rows]) => ({ label, rows }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredTasks, groupBy]);

  const columns: TableColumn<GeneralTaskRecord>[] = [
    { key: 'title', header: 'Task', render: (t) => <button type="button" onClick={() => setSelectedTaskId(t.id)} style={{ background: 'none', border: 'none', color: 'var(--mx-brand)', cursor: 'pointer', textDecoration: 'underline', padding: 0, font: 'inherit' }}>{t.title}</button> },
    { key: 'department', header: 'Department', render: (t) => t.department_name },
    { key: 'assignee', header: 'Assigned To', render: (t) => t.assignee_name || 'Unassigned' },
    { key: 'priority', header: 'Priority', render: (t) => <PriorityBadge tone={GENERAL_TASK_PRIORITY_TONE[t.priority]} label={GENERAL_TASK_PRIORITY_LABEL[t.priority]} /> },
    { key: 'status', header: 'Status', render: (t) => <StatusBadge tone={GENERAL_TASK_STATUS_TONE[t.status]} label={GENERAL_TASK_STATUS_LABEL[t.status]} /> },
    { key: 'start', header: 'Start Date', render: (t) => formatDate(t.start_date) },
    {
      key: 'deadline',
      header: 'Due Date',
      render: (t) => <span className={isOverdue(t, today) ? planner.cardOverdue : undefined}>{formatDate(t.deadline)}</span>
    },
    { key: 'project', header: 'Project', render: (t) => t.project_name || t.tms_project_name || '-' },
    { key: 'actions', header: '', render: (t) => <ToolbarButton onClick={() => setSelectedTaskId(t.id)}>Open</ToolbarButton> }
  ];

  // --- Drag & drop: maps a column drop to the REAL workflow endpoint for
  // that task. Every transition still goes through /update or /review —
  // dragging never bypasses server-side authorization or the required-field
  // rules those routes already enforce (work summary to submit, a remark to
  // rework/reject) — a drop that needs one of those opens a small prompt
  // first instead of firing the request blind.
  function planDrop(task: GeneralTaskRecord, targetColumnKey: string): { kind: 'start' | 'reopen' | 'submit' | 'approve' | 'rework' | 'reject'; needsText: boolean } | null {
    const isMine = task.assignee_username === currentUser.username;
    const isReviewerOrManager = task.reviewer_username === currentUser.username || currentUser.isPrivileged;
    if (targetColumnKey === 'in_progress') {
      if (task.status === 'pending' && isMine) return { kind: 'start', needsText: false };
      if (task.status === 'rework_required' && isMine) return { kind: 'reopen', needsText: false };
      return null;
    }
    if (targetColumnKey === 'under_review') {
      if (task.status === 'in_progress' && isMine) return { kind: 'submit', needsText: true };
      return null;
    }
    if (targetColumnKey === 'done') {
      if (task.status === 'under_review' && isReviewerOrManager) return { kind: 'approve', needsText: false };
      if (task.status === 'in_progress' && isMine && !task.requires_review) return { kind: 'submit', needsText: true };
      return null;
    }
    if (targetColumnKey === 'rework_required') {
      if (task.status === 'under_review' && isReviewerOrManager) return { kind: 'rework', needsText: true };
      return null;
    }
    return null;
  }

  function handleDrop(columnKey: string) {
    setDragOverColumn(null);
    if (!draggingId) return;
    const task = tasks.find((t) => t.id === draggingId);
    setDraggingId(null);
    if (!task) return;
    const plan = planDrop(task, columnKey);
    if (!plan) {
      toast.error("This move isn't allowed from here.");
      return;
    }
    if (plan.needsText) {
      setTransitionText('');
      setTransitionPrompt({ taskId: task.id, kind: plan.kind as 'submit' | 'approve' | 'rework' | 'reject' });
      return;
    }
    void runTransition(task.id, plan.kind, '');
  }

  async function runTransition(taskId: string, kind: 'start' | 'reopen' | 'submit' | 'approve' | 'rework' | 'reject', text: string) {
    setTransitionBusy(true);
    try {
      let response: Response;
      if (kind === 'start' || kind === 'reopen') {
        response = await fetch(`/api/general-tasks/${taskId}/update`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: kind }) });
      } else if (kind === 'submit') {
        response = await fetch(`/api/general-tasks/${taskId}/update`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'submit', workSummary: text.trim() }) });
      } else {
        response = await fetch(`/api/general-tasks/${taskId}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: kind, remark: text.trim() }) });
      }
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || String(response.status));
      }
      setTransitionPrompt(null);
      await load();
      toast.success('Task updated.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'That move was rejected by the server.');
    } finally {
      setTransitionBusy(false);
    }
  }

  // --- Quick Create ---
  const [showCreate, setShowCreate] = useState(false);
  const [moreOptions, setMoreOptions] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [managers, setManagers] = useState<ManagerOption[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [tmsProjects, setTmsProjects] = useState<TmsProjectRecord[]>([]);
  const [confirmBulk, setConfirmBulk] = useState(false);

  function openCreate(preset?: Partial<typeof EMPTY_FORM>) {
    setForm({ ...EMPTY_FORM, ...preset });
    setMoreOptions(false);
    setShowCreate(true);
  }

  useEffect(() => {
    if (!showCreate) return;
    fetch('/api/projects').then((r) => (r.ok ? r.json() : [])).then(setProjects).catch(() => setProjects([]));
    fetch('/api/tms/projects').then((r) => (r.ok ? r.json() : [])).then(setTmsProjects).catch(() => setTmsProjects([]));
  }, [showCreate]);

  useEffect(() => {
    if (!form.departmentId) {
      setEmployees([]);
      setManagers([]);
      return;
    }
    setLoadingEmployees(true);
    fetch(`/api/departments/${form.departmentId}/active-employees`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setEmployees)
      .catch(() => setEmployees([]))
      .finally(() => setLoadingEmployees(false));
    fetch(`/api/departments/${form.departmentId}/managers`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setManagers)
      .catch(() => setManagers([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.departmentId]);

  function toggleSelectedEmployee(id: string) {
    setForm((f) => ({ ...f, assigneeIds: f.assigneeIds.includes(id) ? f.assigneeIds.filter((x) => x !== id) : [...f.assigneeIds, id] }));
  }

  function resolvedAssignMode(): AssignMode {
    return form.assignTarget === 'employee' ? 'employee' : form.assignMode;
  }

  function validateForm(): string | null {
    if (!form.title.trim()) return 'Task Name is required.';
    if (!form.departmentId) return 'Department is required.';
    if (!form.deadline) return 'Deadline is required.';
    if (form.startDate && form.startDate > form.deadline) return 'Due Date cannot be before Start Date.';
    const mode = resolvedAssignMode();
    if (mode === 'employee' && !form.assigneeId) return 'Employee is required.';
    if (mode === 'selected' && form.assigneeIds.length === 0) return 'Select at least one employee.';
    return null;
  }

  function requestSubmit(e: FormEvent) {
    e.preventDefault();
    const error = validateForm();
    if (error) return toast.error(error);
    const mode = resolvedAssignMode();
    if (mode === 'selected' || mode === 'department' || mode === 'manager') {
      setConfirmBulk(true);
      return;
    }
    void doCreate();
  }

  function bulkPreviewNames(): string[] {
    const mode = resolvedAssignMode();
    if (mode === 'selected') return employees.filter((e) => form.assigneeIds.includes(e.id)).map((e) => e.name);
    if (mode === 'department') return employees.map((e) => e.name);
    if (mode === 'manager') return managers.map((m) => m.name);
    return [];
  }

  async function doCreate() {
    setCreating(true);
    setConfirmBulk(false);
    const mode = resolvedAssignMode();
    try {
      const response = await fetch('/api/admin/task-assignment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title.trim(),
          description: form.description.trim(),
          priority: form.priority,
          startDate: form.startDate,
          deadline: form.deadline,
          category: form.category.trim(),
          remarks: form.remarks.trim(),
          requiresReview: form.requiresReview,
          departmentId: form.departmentId,
          projectId: form.projectId,
          tmsProjectId: form.tmsProjectId,
          assignMode: mode,
          assigneeId: form.assigneeId,
          assigneeIds: form.assigneeIds
        })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || String(response.status));
      }
      const body = await response.json();
      const count = body.created?.length ?? 1;
      setShowCreate(false);
      await load();
      toast.success(count > 1 ? `${count} tasks created.` : 'Task assigned.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create this task.');
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return (
      <AppShell title="Task Planner" subtitle="Plan, assign and track work across departments and employees.">
        <div className={historyStyles.tableWrap}><SkeletonRows rows={6} columns={8} /></div>
      </AppShell>
    );
  }
  if (loadFailed) {
    return (
      <AppShell title="Task Planner" subtitle="Plan, assign and track work across departments and employees.">
        <ErrorState message="Could not load Task Planner — check your connection and try again." onRetry={load} />
      </AppShell>
    );
  }

  return (
    <AppShell title="Task Planner" subtitle="Plan, assign and track work across departments and employees.">
      <div className={planner.kpiBar}>
        {KPI_DEFS.map((k) => (
          <button key={k.key} type="button" className={`${planner.kpiCard} ${activeKpi === k.key ? planner.kpiCardActive : ''}`} onClick={() => toggleKpi(k.key)}>
            <div className={`${planner.kpiValue} ${k.danger ? planner.kpiValueDanger : k.warning ? planner.kpiValueWarning : ''}`}>{kpis[k.key] ?? 0}</div>
            <div className={planner.kpiLabel}>{k.label}</div>
          </button>
        ))}
      </div>

      <div className={planner.toolRow}>
        <div className={planner.viewTabs}>
          <ToolbarButton primary={view === 'board'} onClick={() => setView('board')}>Board</ToolbarButton>
          <ToolbarButton primary={view === 'list'} onClick={() => setView('list')}>List</ToolbarButton>
        </div>
        <button type="button" className={calcStyles.btn} onClick={() => openCreate()}>
          <Plus size={15} style={{ verticalAlign: -2, marginRight: 4 }} />New Task
        </button>
      </div>

      <FilterBarRow
        departments={departments}
        filters={filters}
        setFilters={setFilters}
        categories={categories}
        search={search}
        setSearch={setSearch}
        groupBy={groupBy}
        setGroupBy={setGroupBy}
        showGroupBy={view === 'list'}
      />

      {activeChips.length > 0 && (
        <div className={planner.chipRow}>
          {activeChips.map((c) => (
            <span key={c.key} className={planner.chip}>
              {c.label}
              <button type="button" className={planner.chipRemove} onClick={() => removeChip(c.key)} aria-label={`Remove ${c.label} filter`}><X size={12} /></button>
            </span>
          ))}
          <button type="button" className={planner.clearAll} onClick={clearAllFilters}>Clear All</button>
        </div>
      )}

      {filteredTasks.length === 0 ? (
        tasks.length === 0 ? (
          <EmptyState icon={KanbanSquare} title="No tasks yet" message="Create your first task and start tracking work across departments and employees." />
        ) : (
          <EmptyState icon={Search} title="No tasks match these filters" message="Try clearing a filter or changing your search." />
        )
      ) : view === 'board' ? (
        <div className={planner.board}>
          {BOARD_COLUMNS.map((col) => {
            const colTasks = filteredTasks.filter((t) => col.statuses.includes(t.status));
            return (
              <div
                key={col.key}
                className={`${planner.boardColumn} ${dragOverColumn === col.key ? planner.boardColumnDragOver : ''}`}
                onDragOver={(e) => { e.preventDefault(); setDragOverColumn(col.key); }}
                onDragLeave={() => setDragOverColumn((c) => (c === col.key ? null : c))}
                onDrop={(e) => { e.preventDefault(); handleDrop(col.key); }}
              >
                <div className={planner.boardColumnHeader}>
                  <span className={planner.boardColumnTitle}>{col.label}</span>
                  <span className={planner.boardColumnCount}>{colTasks.length}</span>
                </div>
                <div className={planner.boardCards}>
                  {colTasks.length === 0 && <div className={planner.emptyBoardCol}>No tasks</div>}
                  {colTasks.map((t) => (
                    <div
                      key={t.id}
                      className={`${planner.card} ${draggingId === t.id ? planner.cardDragging : ''}`}
                      draggable
                      onDragStart={() => setDraggingId(t.id)}
                      onDragEnd={() => setDraggingId(null)}
                      onClick={() => setSelectedTaskId(t.id)}
                    >
                      <div className={planner.cardTitle}>{t.title}</div>
                      <div className={planner.cardMetaRow}>
                        <PriorityBadge tone={GENERAL_TASK_PRIORITY_TONE[t.priority]} label={GENERAL_TASK_PRIORITY_LABEL[t.priority]} />
                        <span>{t.assignee_name || 'Unassigned'}</span>
                      </div>
                      <div className={planner.cardMetaRow}>
                        <span>{t.department_name}</span>
                        <span className={isOverdue(t, today) ? planner.cardOverdue : undefined}>Due {formatDate(t.deadline)}</span>
                      </div>
                      {t.labels.length > 0 && (
                        <div className={planner.cardLabels}>
                          {t.labels.map((l) => <span key={l} className={planner.cardLabel}>{l}</span>)}
                        </div>
                      )}
                    </div>
                  ))}
                  <ToolbarButton onClick={() => openCreate({ departmentId: filters.departmentId || undefined })}>+ Add Task</ToolbarButton>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        groupedForList.map((group) => (
          <div key={group.label || 'all'}>
            {group.label && <div className={planner.groupHeader}>{group.label} ({group.rows.length})</div>}
            <Table columns={columns} rows={group.rows} rowKey={(t) => t.id} empty={null} />
          </div>
        ))
      )}

      {showCreate && (
        <Drawer
          title="New Task"
          ariaLabel="Create a new task"
          onClose={() => setShowCreate(false)}
          footer={
            <>
              <ToolbarButton onClick={() => setShowCreate(false)}>Cancel</ToolbarButton>
              <SubmitButton form="task-quick-create" disabled={creating}>{creating ? 'Creating…' : 'Create Task'}</SubmitButton>
            </>
          }
        >
          <form id="task-quick-create" onSubmit={requestSubmit}>
            <Field label="Task Name *">
              <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} required autoFocus placeholder="e.g. Submit weekly project status" />
            </Field>

            <div className={planner.formSection}>
              <div className={planner.formSectionTitle}>Assignment</div>

              <Field label="Assign To">
                <div className={planner.segmented}>
                  <button
                    type="button"
                    className={`${planner.segmentBtn} ${form.assignTarget === 'employee' ? planner.segmentBtnActive : ''}`}
                    onClick={() => setForm((f) => ({ ...f, assignTarget: 'employee' }))}
                  >
                    Employee
                  </button>
                  <button
                    type="button"
                    className={`${planner.segmentBtn} ${form.assignTarget === 'department' ? planner.segmentBtnActive : ''}`}
                    onClick={() => setForm((f) => ({ ...f, assignTarget: 'department', assignMode: 'department' }))}
                  >
                    Department
                  </button>
                </div>
              </Field>

              <FieldRow>
                <Field label="Department *">
                  <Select value={form.departmentId} onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value, assigneeId: '', assigneeIds: [] }))} required>
                    <option value="">Select department</option>
                    {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </Select>
                </Field>
                {form.assignTarget === 'employee' ? (
                  <Field label="Employee *">
                    <Select value={form.assigneeId} onChange={(e) => setForm((f) => ({ ...f, assigneeId: e.target.value }))} required disabled={!form.departmentId || loadingEmployees}>
                      <option value="">{loadingEmployees ? 'Loading…' : 'Select employee'}</option>
                      {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.name}{emp.designation ? ` — ${emp.designation}` : ''}</option>)}
                    </Select>
                  </Field>
                ) : (
                  <Field label="Assignment Type">
                    <Select value={form.assignMode} onChange={(e) => setForm((f) => ({ ...f, assignMode: e.target.value as AssignMode, assigneeIds: [] }))}>
                      <option value="department">Entire Department</option>
                      <option value="selected">Selected Employees</option>
                      <option value="manager">Department Manager</option>
                      <option value="unassigned">Leave Unassigned</option>
                    </Select>
                  </Field>
                )}
              </FieldRow>

              {form.assignTarget === 'department' && form.assignMode === 'selected' && (
                <Field label={`Employees (${form.assigneeIds.length} selected)`}>
                  {loadingEmployees ? (
                    <div className={detailStyles.mutedText13}>Loading…</div>
                  ) : (
                    <div className={planner.employeeChipList}>
                      {employees.map((emp) => (
                        <label key={emp.id} className={planner.assignModeOption}>
                          <input type="checkbox" checked={form.assigneeIds.includes(emp.id)} onChange={() => toggleSelectedEmployee(emp.id)} /> {emp.name}
                        </label>
                      ))}
                      {employees.length === 0 && <span className={detailStyles.mutedText13}>No active employees in this department.</span>}
                    </div>
                  )}
                </Field>
              )}
              {form.assignTarget === 'department' && form.assignMode === 'department' && (
                <div className={planner.assignHint}>Creates one individually-traceable task for every active employee in this department ({employees.length}).</div>
              )}
              {form.assignTarget === 'department' && form.assignMode === 'manager' && (
                <div className={planner.assignHint}>{managers.length ? `Assigned to: ${managers.map((m) => m.name).join(', ')}` : 'This department has no manager configured.'}</div>
              )}
              {form.assignTarget === 'department' && form.assignMode === 'unassigned' && (
                <div className={planner.assignHint}>No owner yet — this department&apos;s managers will be notified and can assign it later.</div>
              )}
            </div>

            <FieldRow>
              <Field label="Deadline *">
                <Input type="date" min={today} value={form.deadline} onChange={(e) => setForm((f) => ({ ...f, deadline: e.target.value }))} required />
              </Field>
              <Field label="Priority">
                <Select value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as GeneralTaskPriority }))}>
                  {(Object.keys(GENERAL_TASK_PRIORITY_LABEL) as GeneralTaskPriority[]).map((p) => <option key={p} value={p}>{GENERAL_TASK_PRIORITY_LABEL[p]}</option>)}
                </Select>
              </Field>
            </FieldRow>

            <button type="button" className={planner.moreOptionsToggle} onClick={() => setMoreOptions((v) => !v)}>
              <ChevronDown size={15} className={`${planner.moreOptionsChevron} ${moreOptions ? planner.moreOptionsChevronOpen : ''}`} />
              {moreOptions ? 'Fewer Options' : 'More Options'}
            </button>

            {moreOptions && (
              <>
                <Field label="Description">
                  <Textarea rows={3} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
                </Field>
                <FieldRow>
                  <Field label="Start Date">
                    <Input type="date" max={form.deadline || undefined} value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
                  </Field>
                  <Field label="Category">
                    <Input value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} placeholder="e.g. Documentation, Coordination" />
                  </Field>
                </FieldRow>
                <Field label="Requires Review">
                  <Select value={form.requiresReview ? 'yes' : 'no'} onChange={(e) => setForm((f) => ({ ...f, requiresReview: e.target.value === 'yes' }))}>
                    <option value="yes">Yes — review before it&apos;s marked done</option>
                    <option value="no">No — auto-complete on submission</option>
                  </Select>
                </Field>
                <FieldRow>
                  <Field label="Link To — Existing Project">
                    <Select value={form.projectId} onChange={(e) => setForm((f) => ({ ...f, projectId: e.target.value }))}>
                      <option value="">No project</option>
                      {projects.map((p) => <option key={p.id} value={p.id}>{p.client_name || p.company || p.id}</option>)}
                    </Select>
                  </Field>
                  <Field label="Link To — TMS Project">
                    <Select value={form.tmsProjectId} onChange={(e) => setForm((f) => ({ ...f, tmsProjectId: e.target.value }))}>
                      <option value="">No TMS project</option>
                      {tmsProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </Select>
                  </Field>
                </FieldRow>
                <Field label="Remarks">
                  <Textarea rows={2} value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} />
                </Field>
              </>
            )}
          </form>
        </Drawer>
      )}

      {confirmBulk && (
        <Modal title="Confirm Assignment" ariaLabel="Confirm bulk assignment" onClose={() => setConfirmBulk(false)} footer={
          <>
            <ModalCancelButton onClick={() => setConfirmBulk(false)}>Cancel</ModalCancelButton>
            <ModalOkButton disabled={creating} onClick={() => void doCreate()}>{creating ? 'Assigning…' : `Assign to ${bulkPreviewNames().length || 0}`}</ModalOkButton>
          </>
        }>
          {resolvedAssignMode() === 'manager' ? (
            <p>Assign &quot;{form.title}&quot; to this department&apos;s manager{managers.length > 1 ? 's' : ''}?</p>
          ) : (
            <p>Assign &quot;{form.title}&quot; to {bulkPreviewNames().length} employee{bulkPreviewNames().length === 1 ? '' : 's'}?</p>
          )}
          <div className={planner.confirmPreview}>{bulkPreviewNames().join(', ') || 'No one'}</div>
        </Modal>
      )}

      {transitionPrompt && (
        <Modal
          title={transitionPrompt.kind === 'submit' ? 'Submit for Review' : transitionPrompt.kind === 'approve' ? 'Approve Task' : transitionPrompt.kind === 'rework' ? 'Send Back for Rework' : 'Reject Task'}
          ariaLabel="Confirm status change"
          onClose={() => setTransitionPrompt(null)}
          footer={
            <>
              <ModalCancelButton onClick={() => setTransitionPrompt(null)}>Cancel</ModalCancelButton>
              <ModalOkButton disabled={transitionBusy} onClick={() => void runTransition(transitionPrompt.taskId, transitionPrompt.kind, transitionText)}>
                {transitionBusy ? 'Saving…' : 'Confirm'}
              </ModalOkButton>
            </>
          }
        >
          <Textarea
            rows={3}
            placeholder={transitionPrompt.kind === 'submit' ? 'Work summary (required)' : transitionPrompt.kind === 'approve' ? 'Remark (optional)' : 'Remark (required)'}
            value={transitionText}
            onChange={(e) => setTransitionText(e.target.value)}
          />
        </Modal>
      )}

      {selectedTaskId && (
        <Drawer title="Task Details" ariaLabel="Task details" onClose={() => setSelectedTaskId(null)}>
          <GeneralTaskDetailPanel taskId={selectedTaskId} onChanged={load} />
        </Drawer>
      )}
    </AppShell>
  );
}

function FilterBarRow({
  departments,
  filters,
  setFilters,
  categories,
  search,
  setSearch,
  groupBy,
  setGroupBy,
  showGroupBy
}: {
  departments: DepartmentRecord[];
  filters: Filters;
  setFilters: (updater: (f: Filters) => Filters) => void;
  categories: string[];
  search: string;
  setSearch: (v: string) => void;
  groupBy: GroupKey;
  setGroupBy: (v: GroupKey) => void;
  showGroupBy: boolean;
}) {
  return (
    <div className={historyStyles.toolbar} style={{ marginBottom: 12 }}>
      <input type="text" placeholder="Search tasks…" value={search} onChange={(e) => setSearch(e.target.value)} />
      <Select auto value={filters.departmentId} onChange={(e) => setFilters((f) => ({ ...f, departmentId: e.target.value }))}>
        <option value="">All departments</option>
        {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </Select>
      <Select auto value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value as GeneralTaskStatus | '' }))}>
        <option value="">All statuses</option>
        {(Object.keys(GENERAL_TASK_STATUS_LABEL) as GeneralTaskStatus[]).map((s) => <option key={s} value={s}>{GENERAL_TASK_STATUS_LABEL[s]}</option>)}
      </Select>
      <Select auto value={filters.priority} onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value as GeneralTaskPriority | '' }))}>
        <option value="">All priorities</option>
        {(Object.keys(GENERAL_TASK_PRIORITY_LABEL) as GeneralTaskPriority[]).map((p) => <option key={p} value={p}>{GENERAL_TASK_PRIORITY_LABEL[p]}</option>)}
      </Select>
      {categories.length > 0 && (
        <Select auto value={filters.category} onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
      )}
      {showGroupBy && (
        <Select auto value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupKey)}>
          {GROUP_OPTIONS.map((g) => <option key={g.key} value={g.key}>Group by {g.label}</option>)}
        </Select>
      )}
    </div>
  );
}
