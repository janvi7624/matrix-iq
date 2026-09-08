'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Users } from 'lucide-react';
import { DepartmentRecord } from '@/lib/types';
import AppShell from './AppShell';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import { SkeletonRows } from './ui/Skeleton';
import EmptyState from './ui/EmptyState';
import ErrorState from './ui/ErrorState';
import FilterBar from './ui/FilterBar';
import Table, { TableColumn } from './ui/Table';
import { Field, FieldRow } from './ui/Field';
import Input from './ui/Input';
import Select from './ui/Select';
import SubmitButton from './ui/SubmitButton';
import ToolbarButton from './ui/ToolbarButton';
import { useToast } from './ui/ToastProvider';

interface Employee {
  id: string;
  username: string;
  name: string;
  designation: string;
  department: string;
  role: string;
  email: string;
  phone: string;
}

interface RoleOption {
  key: string;
  label: string;
}

const EMPTY_FORM = {
  name: '',
  username: '',
  password: '',
  phone: '',
  email: '',
  employeeId: '',
  designation: '',
  departmentId: '',
  role: '',
  isDepartmentManager: false
};

interface HrEmployeesViewProps {
  // Only an actual HR manager (or admin/superadmin) gets the New Employee
  // form — a plain 'hr'-role employee can still browse the directory below,
  // same split HR Tasks already uses for who may assign vs. just view.
  canCreate: boolean;
}

export default function HrEmployeesView({ canCreate }: HrEmployeesViewProps) {
  const toast = useToast();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [departments, setDepartments] = useState<DepartmentRecord[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    setLoadFailed(false);
    try {
      const response = await fetch('/api/hr/employees');
      if (!response.ok) throw new Error(String(response.status));
      setEmployees(await response.json());
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
    if (!canCreate) return;
    Promise.all([fetch('/api/departments'), fetch('/api/hr/roles')]).then(async ([deptRes, roleRes]) => {
      if (deptRes.ok) setDepartments(await deptRes.json());
      if (roleRes.ok) setRoles(await roleRes.json());
    });
  }, [canCreate]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.username.trim() || !form.password) {
      return toast.error('Name, username, and password are required.');
    }
    if (!form.departmentId) return toast.error('Department is required.');

    setCreating(true);
    try {
      const response = await fetch('/api/hr/employees', {
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
      toast.success('Employee profile created.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create this employee.');
    } finally {
      setCreating(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((e) => [e.name, e.department, e.designation, e.role].some((v) => v.toLowerCase().includes(q)));
  }, [employees, search]);

  const columns: TableColumn<Employee>[] = [
    { key: 'name', header: 'Name', render: (e) => e.name },
    { key: 'department', header: 'Department', render: (e) => e.department || '-' },
    { key: 'designation', header: 'Designation', render: (e) => e.designation || '-' },
    { key: 'role', header: 'Role', render: (e) => e.role || '-' },
    { key: 'email', header: 'Email', render: (e) => e.email || '-' },
    { key: 'phone', header: 'Phone', render: (e) => e.phone || '-' }
  ];

  if (loading) {
    return (
      <AppShell title="Employees" subtitle="Active employee directory.">
        <div className={historyStyles.tableWrap}><SkeletonRows rows={8} columns={6} /></div>
      </AppShell>
    );
  }
  if (loadFailed) {
    return (
      <AppShell title="Employees" subtitle="Active employee directory.">
        <ErrorState message="Could not load employees — check your connection and try again." onRetry={load} />
      </AppShell>
    );
  }

  return (
    <AppShell title="Employees" subtitle="Active employee directory.">
      {canCreate && (
        <div className={historyStyles.tableWrap} style={{ marginBottom: 16 }}>
          <ToolbarButton primary={showForm} onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : 'New Employee'}
          </ToolbarButton>
          {showForm && (
            <form className={`${calcStyles.sectionPanel} ${calcStyles.sectionPanelSpaced}`} onSubmit={handleCreate} style={{ marginTop: 12 }}>
              <FieldRow>
                <Field label="Full Name">
                  <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
                </Field>
                <Field label="Username">
                  <Input value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} required />
                </Field>
                <Field label="Temporary Password">
                  <Input type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} required minLength={6} />
                </Field>
              </FieldRow>
              <FieldRow>
                <Field label="Department">
                  <Select value={form.departmentId} onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))} required>
                    <option value="">Select department</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Role">
                  <Select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
                    <option value="">Employee (default)</option>
                    {roles.map((r) => (
                      <option key={r.key} value={r.key}>{r.label}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Designation">
                  <Input value={form.designation} onChange={(e) => setForm((f) => ({ ...f, designation: e.target.value }))} />
                </Field>
              </FieldRow>
              <FieldRow>
                <Field label="Phone">
                  <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
                </Field>
                <Field label="Email">
                  <Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
                </Field>
                <Field label="Employee ID">
                  <Input value={form.employeeId} onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))} />
                </Field>
              </FieldRow>
              <Field>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600 }}>
                  <input
                    type="checkbox"
                    checked={form.isDepartmentManager}
                    onChange={(e) => setForm((f) => ({ ...f, isDepartmentManager: e.target.checked }))}
                  />
                  Make this person a manager of the selected department
                </label>
              </Field>
              <SubmitButton disabled={creating}>{creating ? 'Creating…' : 'Create Employee'}</SubmitButton>
            </form>
          )}
        </div>
      )}

      <FilterBar>
        <input type="text" placeholder="Search name, department, role…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </FilterBar>
      <Table
        columns={columns}
        rows={filtered}
        rowKey={(e) => e.id}
        empty={<EmptyState icon={Users} title="No employees found" message="Active employees will appear here." />}
      />
    </AppShell>
  );
}
