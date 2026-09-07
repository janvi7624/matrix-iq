'use client';

import { useEffect, useMemo, useState } from 'react';
import { Users } from 'lucide-react';
import AppShell from './AppShell';
import historyStyles from './quotationHistory.module.css';
import { SkeletonRows } from './ui/Skeleton';
import EmptyState from './ui/EmptyState';
import ErrorState from './ui/ErrorState';
import FilterBar from './ui/FilterBar';
import Table, { TableColumn } from './ui/Table';

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

export default function HrEmployeesView() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [search, setSearch] = useState('');

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
