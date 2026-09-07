'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Send } from 'lucide-react';
import { DepartmentRecord, GeneralTaskRecord, GeneralTaskPriority, UserRole } from '@/lib/types';
import { GENERAL_TASK_PRIORITY_LABEL, GENERAL_TASK_PRIORITY_TONE, GENERAL_TASK_STATUS_LABEL, GENERAL_TASK_STATUS_TONE } from '@/lib/generalTaskLabels';
import AppShell from './AppShell';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
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
import SubmitButton from './ui/SubmitButton';
import Table, { TableColumn } from './ui/Table';

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
  category: '',
  remarks: '',
  requiresReview: true
};

function formatDate(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleDateString('en-IN');
  } catch {
    return iso;
  }
}

interface AdminTaskAssignmentViewProps {
  currentUser: { username: string; name: string; role: UserRole };
}

export default function AdminTaskAssignmentView({ currentUser }: AdminTaskAssignmentViewProps) {
  void currentUser;
  const toast = useToast();
  const [departments, setDepartments] = useState<DepartmentRecord[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [tasks, setTasks] = useState<GeneralTaskRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);

  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

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

  // Department -> Employee cascade: refetch whenever the department
  // selection changes, and always clear the previously-selected employee so
  // a stale cross-department pairing can never be submitted.
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
    if (!form.title.trim()) return toast.error('Task name is required.');
    if (!form.departmentId) return toast.error('Department is required.');
    if (!form.assigneeId) return toast.error('Employee is required.');
    if (!form.deadline) return toast.error('Deadline is required.');

    setCreating(true);
    try {
      const response = await fetch('/api/admin/task-assignment', {
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
      setShowForm(false);
      await load();
      toast.success('Task assigned.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not assign this task.');
    } finally {
      setCreating(false);
    }
  }

  const columns: TableColumn<GeneralTaskRecord>[] = [
    { key: 'title', header: 'Task', render: (t) => t.title },
    { key: 'department', header: 'Department', render: (t) => t.department_name },
    { key: 'assignee', header: 'Assigned To', render: (t) => t.assignee_name },
    { key: 'priority', header: 'Priority', render: (t) => <PriorityBadge tone={GENERAL_TASK_PRIORITY_TONE[t.priority]} label={GENERAL_TASK_PRIORITY_LABEL[t.priority]} /> },
    { key: 'status', header: 'Status', render: (t) => <StatusBadge tone={GENERAL_TASK_STATUS_TONE[t.status]} label={GENERAL_TASK_STATUS_LABEL[t.status]} /> },
    {
      key: 'deadline',
      header: 'Deadline',
      render: (t) => (
        <span style={t.deadline && t.deadline < todayIso && t.status !== 'approved' && t.status !== 'completed' && t.status !== 'cancelled' ? { color: 'var(--mx-danger)', fontWeight: 600 } : undefined}>
          {formatDate(t.deadline)}
        </span>
      )
    },
    { key: 'actions', header: '', render: (t) => <Link className={historyStyles.button} href={`/my-tasks/${t.id}`}>View</Link> }
  ];

  return (
    <AppShell title="Assign Task" subtitle="Assign a task to any employee in any department.">
      <div className={historyStyles.actionRow}>
        <button type="button" className={calcStyles.btn} onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Cancel' : '+ Assign Task'}
        </button>
      </div>

      {showForm && (
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
                  <option key={emp.id} value={emp.id}>{emp.name}{emp.designation ? ` — ${emp.designation}` : ''}</option>
                ))}
              </Select>
            </Field>
            <Field label="Priority">
              <Select value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as GeneralTaskPriority }))}>
                {(Object.keys(GENERAL_TASK_PRIORITY_LABEL) as GeneralTaskPriority[]).map((p) => (
                  <option key={p} value={p}>{GENERAL_TASK_PRIORITY_LABEL[p]}</option>
                ))}
              </Select>
            </Field>
          </FieldRow>
          <Field label="Task Name">
            <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} required />
          </Field>
          <Field label="Description">
            <Textarea rows={3} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </Field>
          <FieldRow>
            <Field label="Deadline">
              <Input type="date" min={todayIso} value={form.deadline} onChange={(e) => setForm((f) => ({ ...f, deadline: e.target.value }))} required />
            </Field>
            <Field label="Task Category (optional)">
              <Input value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} placeholder="e.g. Documentation, Coordination" />
            </Field>
            <Field label="Requires Review">
              <Select value={form.requiresReview ? 'yes' : 'no'} onChange={(e) => setForm((f) => ({ ...f, requiresReview: e.target.value === 'yes' }))}>
                <option value="yes">Yes — I&apos;ll review before it&apos;s marked done</option>
                <option value="no">No — auto-complete on submission</option>
              </Select>
            </Field>
          </FieldRow>
          <Field label="Remarks">
            <Textarea rows={2} value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} />
          </Field>
          <SubmitButton disabled={creating}>{creating ? 'Assigning…' : 'Assign Task'}</SubmitButton>
        </form>
      )}

      {loading ? (
        <div className={historyStyles.tableWrap}><SkeletonRows rows={6} columns={7} /></div>
      ) : loadFailed ? (
        <ErrorState message="Could not load assigned tasks — check your connection and try again." onRetry={load} />
      ) : (
        <Table
          columns={columns}
          rows={tasks}
          rowKey={(t) => t.id}
          empty={<EmptyState icon={Send} title="No tasks assigned yet" message="Tasks you assign across departments will appear here." />}
        />
      )}
    </AppShell>
  );
}
