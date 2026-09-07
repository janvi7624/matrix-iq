'use client';

import { useEffect, useState } from 'react';
import { CalendarCheck } from 'lucide-react';
import { AttendanceRecordEntry, AttendanceStatus } from '@/lib/types';
import AppShell from './AppShell';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import { useToast } from './ui/ToastProvider';
import { SkeletonRows } from './ui/Skeleton';
import EmptyState from './ui/EmptyState';
import ErrorState from './ui/ErrorState';
import { Field } from './ui/Field';
import Input from './ui/Input';
import Select from './ui/Select';
import Table, { TableColumn } from './ui/Table';

const STATUS_OPTIONS: AttendanceStatus[] = ['present', 'absent', 'half_day', 'on_leave', 'holiday', 'wfh'];
const STATUS_LABEL: Record<AttendanceStatus, string> = { present: 'Present', absent: 'Absent', half_day: 'Half Day', on_leave: 'On Leave', holiday: 'Holiday', wfh: 'WFH' };

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

interface HrAttendanceViewProps {
  isHrManager: boolean;
}

export default function HrAttendanceView({ isHrManager }: HrAttendanceViewProps) {
  const toast = useToast();
  const [date, setDate] = useState(todayIso());
  const [records, setRecords] = useState<AttendanceRecordEntry[]>([]);
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  async function load() {
    setLoading(true);
    setLoadFailed(false);
    try {
      const [recRes, empRes] = await Promise.all([fetch(`/api/hr/attendance?date=${date}`), fetch('/api/hr/employees')]);
      if (!recRes.ok) throw new Error(String(recRes.status));
      setRecords(await recRes.json());
      if (empRes.ok) setEmployees(await empRes.json());
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  async function mark(userId: string, status: AttendanceStatus) {
    try {
      const response = await fetch('/api/hr/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, date, status })
      });
      if (!response.ok) throw new Error(String(response.status));
      await load();
      toast.success('Attendance updated.');
    } catch {
      toast.error('Could not update attendance.');
    }
  }

  const recordByUser = new Map(records.map((r) => [r.user_id, r]));
  const rows = employees.map((e) => ({ id: e.id, name: e.name, status: recordByUser.get(e.id)?.status, remarks: recordByUser.get(e.id)?.remarks || '' }));

  const columns: TableColumn<(typeof rows)[number]>[] = [
    { key: 'name', header: 'Employee', render: (r) => r.name },
    {
      key: 'status',
      header: 'Status',
      render: (r) =>
        isHrManager ? (
          <Select value={r.status || ''} onChange={(e) => mark(r.id, e.target.value as AttendanceStatus)}>
            <option value="">Not marked</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </Select>
        ) : (
          <span>{r.status ? STATUS_LABEL[r.status] : 'Not marked'}</span>
        )
    }
  ];

  if (loading) {
    return (
      <AppShell title="Attendance" subtitle="Daily presence register.">
        <div className={historyStyles.tableWrap}><SkeletonRows rows={8} columns={2} /></div>
      </AppShell>
    );
  }
  if (loadFailed) {
    return (
      <AppShell title="Attendance" subtitle="Daily presence register.">
        <ErrorState message="Could not load attendance — check your connection and try again." onRetry={load} />
      </AppShell>
    );
  }

  return (
    <AppShell title="Attendance" subtitle="Daily presence register.">
      <div className={`${calcStyles.field} ${calcStyles.mt10}`} style={{ maxWidth: 220 }}>
        <Field label="Date">
          <Input type="date" max={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <Table
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        empty={<EmptyState icon={CalendarCheck} title="No employees found" message="Active employees will appear here." />}
      />
    </AppShell>
  );
}
