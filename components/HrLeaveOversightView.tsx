'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarOff } from 'lucide-react';
import { LeaveRequestRecord, LeaveStatus, LeaveType } from '@/lib/types';
import AppShell from './AppShell';
import historyStyles from './quotationHistory.module.css';
import { SkeletonRows } from './ui/Skeleton';
import EmptyState from './ui/EmptyState';
import ErrorState from './ui/ErrorState';
import FilterBar from './ui/FilterBar';
import Select from './ui/Select';
import StatusBadge from './ui/StatusBadge';
import Table, { TableColumn } from './ui/Table';

const LEAVE_TYPE_LABEL: Record<LeaveType, string> = { casual: 'Casual', sick: 'Sick', earned: 'Earned', unpaid: 'Unpaid', other: 'Other' };
const STATUS_TONE = { pending: 'pending', approved: 'done', rejected: 'rejected', cancelled: 'cancelled' } as const;

function formatDate(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleDateString('en-IN');
  } catch {
    return iso;
  }
}

// Org-wide read view (HR + Admin + Super Admin, via hr-leave's
// HR_RESTRICTED_KEYS gate) — decisions themselves still happen on the
// universal /leave page (a department manager or HR manager acting on
// their own team's pending requests), not duplicated here.
export default function HrLeaveOversightView() {
  const [rows, setRows] = useState<LeaveRequestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [status, setStatus] = useState<LeaveStatus | ''>('');

  async function load(nextStatus = status) {
    setLoading(true);
    setLoadFailed(false);
    try {
      const response = await fetch(`/api/hr/leave${nextStatus ? `?status=${nextStatus}` : ''}`);
      if (!response.ok) throw new Error(String(response.status));
      setRows(await response.json());
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const columns: TableColumn<LeaveRequestRecord>[] = useMemo(
    () => [
      { key: 'employee', header: 'Employee', render: (r) => r.user_name },
      { key: 'type', header: 'Type', render: (r) => LEAVE_TYPE_LABEL[r.leave_type] },
      { key: 'dates', header: 'Dates', render: (r) => `${formatDate(r.start_date)} - ${formatDate(r.end_date)}` },
      { key: 'days', header: 'Days', render: (r) => r.days },
      { key: 'status', header: 'Status', render: (r) => <StatusBadge tone={STATUS_TONE[r.status]} label={r.status} /> },
      { key: 'approvedBy', header: 'Decided By', render: (r) => r.approved_by_name || '-' }
    ],
    []
  );

  if (loading) {
    return (
      <AppShell title="Leave (HR)" subtitle="Org-wide leave request oversight.">
        <div className={historyStyles.tableWrap}><SkeletonRows rows={6} columns={6} /></div>
      </AppShell>
    );
  }
  if (loadFailed) {
    return (
      <AppShell title="Leave (HR)" subtitle="Org-wide leave request oversight.">
        <ErrorState message="Could not load leave requests — check your connection and try again." onRetry={() => load()} />
      </AppShell>
    );
  }

  return (
    <AppShell title="Leave (HR)" subtitle="Org-wide leave request oversight.">
      <FilterBar>
        <Select
          auto
          value={status}
          onChange={(e) => {
            const v = e.target.value as LeaveStatus | '';
            setStatus(v);
            load(v);
          }}
        >
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="cancelled">Cancelled</option>
        </Select>
      </FilterBar>
      <Table columns={columns} rows={rows} rowKey={(r) => r.id} empty={<EmptyState icon={CalendarOff} title="No leave requests" message="Leave requests will appear here." />} />
    </AppShell>
  );
}
