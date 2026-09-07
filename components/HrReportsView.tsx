'use client';

import { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import AppShell from './AppShell';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import { SkeletonRows } from './ui/Skeleton';
import EmptyState from './ui/EmptyState';
import ErrorState from './ui/ErrorState';
import FilterBar from './ui/FilterBar';
import Select from './ui/Select';
import Input from './ui/Input';

type ReportType = 'daily' | 'monthly' | 'employee';

interface DailyRow { employee: string; department: string; assigned: number; completed: number; pending: number; overdue: number; submitted: number }
interface MonthlySummary { totalAssigned: number; completed: number; overdue: number; completionPercent: number; onTimePercent: number; reworkCount: number }
interface EmployeeRow { id: string; title: string; department: string; priority: string; category: string; status: string; deadline: string; overdue: boolean }

export default function HrReportsView() {
  const [type, setType] = useState<ReportType>('daily');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [daily, setDaily] = useState<DailyRow[]>([]);
  const [monthly, setMonthly] = useState<MonthlySummary | null>(null);
  const [employee, setEmployee] = useState<EmployeeRow[]>([]);

  async function load() {
    setLoading(true);
    setLoadFailed(false);
    try {
      const params = new URLSearchParams({ type });
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const response = await fetch(`/api/hr/reports?${params.toString()}`);
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json();
      if (type === 'daily') setDaily(data.rows || []);
      else if (type === 'monthly') setMonthly(data);
      else setEmployee(data.rows || []);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  return (
    <AppShell title="HR Reports" subtitle="Daily task, monthly performance, and employee work reports.">
      <FilterBar>
        <Select auto value={type} onChange={(e) => setType(e.target.value as ReportType)}>
          <option value="daily">Daily Task Report</option>
          <option value="monthly">Monthly HR Performance</option>
          <option value="employee">Employee Work Report</option>
        </Select>
        <Input auto type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input auto type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <button type="button" className={historyStyles.button} onClick={load}>Apply</button>
      </FilterBar>

      {loading ? (
        <div className={historyStyles.tableWrap}><SkeletonRows rows={6} columns={5} /></div>
      ) : loadFailed ? (
        <ErrorState message="Could not load this report — check your connection and try again." onRetry={load} />
      ) : type === 'daily' ? (
        daily.length === 0 ? (
          <EmptyState icon={FileText} title="No data" message="No tasks match this date range." />
        ) : (
          <div className={historyStyles.tableWrap}>
            <table className={historyStyles.table}>
              <thead><tr><th>Employee</th><th>Department</th><th>Assigned</th><th>Completed</th><th>Pending</th><th>Submitted</th><th>Overdue</th></tr></thead>
              <tbody>
                {daily.map((r, i) => (
                  <tr key={i}>
                    <td>{r.employee}</td><td>{r.department}</td><td>{r.assigned}</td><td>{r.completed}</td><td>{r.pending}</td><td>{r.submitted}</td><td>{r.overdue}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : type === 'monthly' ? (
        monthly && (
          <div className={historyStyles.summaryCardGrid}>
            <div className={historyStyles.summaryCard}><div className={historyStyles.summaryCardLabel}>Total Assigned</div><div className={historyStyles.summaryCardValue}>{monthly.totalAssigned}</div></div>
            <div className={historyStyles.summaryCard}><div className={historyStyles.summaryCardLabel}>Completed</div><div className={historyStyles.summaryCardValue}>{monthly.completed}</div></div>
            <div className={historyStyles.summaryCard}><div className={historyStyles.summaryCardLabel}>Overdue</div><div className={historyStyles.summaryCardValue}>{monthly.overdue}</div></div>
            <div className={historyStyles.summaryCard}><div className={historyStyles.summaryCardLabel}>Completion %</div><div className={historyStyles.summaryCardValue}>{monthly.completionPercent}%</div></div>
            <div className={historyStyles.summaryCard}><div className={historyStyles.summaryCardLabel}>On-Time %</div><div className={historyStyles.summaryCardValue}>{monthly.onTimePercent}%</div></div>
            <div className={historyStyles.summaryCard}><div className={historyStyles.summaryCardLabel}>Rework Count</div><div className={historyStyles.summaryCardValue}>{monthly.reworkCount}</div></div>
          </div>
        )
      ) : employee.length === 0 ? (
        <EmptyState icon={FileText} title="No data" message="No tasks match this date range." />
      ) : (
        <div className={`${calcStyles.sectionPanel}`}>
          <div className={historyStyles.tableWrap}>
            <table className={historyStyles.table}>
              <thead><tr><th>Task</th><th>Department</th><th>Priority</th><th>Category</th><th>Status</th><th>Deadline</th></tr></thead>
              <tbody>
                {employee.map((r) => (
                  <tr key={r.id}>
                    <td>{r.title}</td><td>{r.department}</td><td>{r.priority}</td><td>{r.category || '-'}</td><td>{r.status}</td>
                    <td style={r.overdue ? { color: 'var(--mx-danger)', fontWeight: 600 } : undefined}>{r.deadline}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AppShell>
  );
}
