'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { TmsBomRequestRecord, TmsProcurementRecord, TmsProjectRecord, TmsTaskRecord, TmsTaskStatus, UserRole } from '@/lib/types';
import { TMS_DEPARTMENTS } from '@/lib/tmsConstants';
import { TMS_TASK_STATUS_LABEL, todayIso } from '@/lib/tmsLabels';
import AppShell from './AppShell';
import dashboardStyles from './dashboard.module.css';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import ErrorState from './ui/ErrorState';

interface DashboardResponse {
  projects: TmsProjectRecord[];
  tasks: TmsTaskRecord[];
  bomRequests: TmsBomRequestRecord[];
  procurements: TmsProcurementRecord[];
}

interface TmsDashboardViewProps {
  currentUser: { username: string; role: UserRole };
}

export default function TmsDashboardView({ currentUser }: TmsDashboardViewProps) {
  void currentUser;
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const [fDepartment, setFDepartment] = useState('');
  const [fProject, setFProject] = useState('');
  const [fAssignee, setFAssignee] = useState('');
  const [fDate, setFDate] = useState(todayIso());
  const [fTaskStatus, setFTaskStatus] = useState<TmsTaskStatus | ''>('');

  async function load() {
    setLoadFailed(false);
    try {
      const response = await fetch('/api/tms/dashboard');
      if (!response.ok) throw new Error(String(response.status));
      setData(await response.json());
    } catch {
      setLoadFailed(true);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const projectIdsInDept = useMemo(() => {
    if (!data || !fDepartment) return null;
    return new Set(data.projects.filter((p) => p.department_name === fDepartment).map((p) => p.id));
  }, [data, fDepartment]);

  const projects = useMemo(() => {
    if (!data) return [];
    return data.projects.filter((p) => (!fDepartment || p.department_name === fDepartment) && (!fProject || p.id === fProject));
  }, [data, fDepartment, fProject]);

  const tasks = useMemo(() => {
    if (!data) return [];
    return data.tasks.filter(
      (t) =>
        (!fDepartment || !projectIdsInDept || projectIdsInDept.has(t.project_id)) &&
        (!fProject || t.project_id === fProject) &&
        (!fAssignee || t.assignee_id === fAssignee) &&
        (!fTaskStatus || t.status === fTaskStatus)
    );
  }, [data, fDepartment, fProject, fAssignee, fTaskStatus, projectIdsInDept]);

  const bomRequests = useMemo(() => {
    if (!data) return [];
    return data.bomRequests.filter((b) => (!fDepartment || !projectIdsInDept || projectIdsInDept.has(b.project_id)) && (!fProject || b.project_id === fProject));
  }, [data, fDepartment, fProject, projectIdsInDept]);

  const procurements = useMemo(() => {
    if (!data) return [];
    return data.procurements.filter((p) => (!fDepartment || !projectIdsInDept || projectIdsInDept.has(p.project_id)) && (!fProject || p.project_id === fProject));
  }, [data, fDepartment, fProject, projectIdsInDept]);

  const assignees = useMemo(() => {
    const map = new Map<string, string>();
    (data?.tasks || []).forEach((t) => {
      if (t.assignee_id) map.set(t.assignee_id, t.assignee_name || t.assignee_id);
    });
    return Array.from(map.entries());
  }, [data]);

  const projectStats = useMemo(() => {
    const date = fDate || todayIso();
    const active = projects.filter((p) => p.status !== 'completed' && p.status !== 'cancelled');
    const nearDeadline = active.filter((p) => p.estimated_close_date && p.estimated_close_date >= date && p.estimated_close_date <= addDays(date, 7));
    const delayed = active.filter((p) => p.estimated_close_date && p.estimated_close_date < date);
    return {
      total: projects.length,
      active: active.length,
      completed: projects.filter((p) => p.status === 'completed').length,
      nearDeadline: nearDeadline.length,
      delayed: delayed.length
    };
  }, [projects, fDate]);

  const taskStats = useMemo(() => {
    const date = fDate || todayIso();
    const activeTask = (t: TmsTaskRecord) => t.status !== 'completed' && t.status !== 'cancelled';
    const today = tasks.filter((t) => activeTask(t) && t.start_date && t.start_date <= date && (!t.due_date || t.due_date >= date));
    const pending = tasks.filter((t) => t.status === 'to_do' || t.status === 'in_progress' || t.status === 'on_hold');
    const completedToday = tasks.filter((t) => t.completion_date === date);
    const overdue = tasks.filter((t) => activeTask(t) && t.due_date && t.due_date < date);
    const byAssignee = new Map<string, number>();
    tasks.forEach((t) => {
      const label = t.assignee_name || 'Unassigned';
      byAssignee.set(label, (byAssignee.get(label) || 0) + 1);
    });
    return { today: today.length, pending: pending.length, completedToday: completedToday.length, overdue: overdue.length, byAssignee: [...byAssignee.entries()].sort((a, b) => b[1] - a[1]) };
  }, [tasks, fDate]);

  const bomStats = useMemo(() => {
    const pending = bomRequests.filter((b) => b.status === 'draft' || b.status === 'submitted' || b.status === 'under_review');
    const approved = bomRequests.filter((b) => b.status === 'approved' || b.status === 'sent_for_procurement' || b.status === 'completed');
    const awaitingReview = bomRequests.filter((b) => b.status === 'submitted' || b.status === 'under_review');
    return { pending: pending.length, approved: approved.length, awaitingReview: awaitingReview.length };
  }, [bomRequests]);

  const procurementStats = useMemo(() => {
    const pending = procurements.filter((p) => ['requested', 'quotation_required', 'quotation_received'].includes(p.purchase_status));
    const approvalPending = procurements.filter((p) => p.purchase_status === 'approval_pending');
    const ordered = procurements.filter((p) => p.purchase_status === 'ordered' || p.purchase_status === 'po_created');
    const awaitingDelivery = procurements.filter((p) => p.delivery_status === 'pending' || p.delivery_status === 'partially_received');
    return { pending: pending.length, approvalPending: approvalPending.length, ordered: ordered.length, awaitingDelivery: awaitingDelivery.length };
  }, [procurements]);

  if (loadFailed) {
    return (
      <AppShell title="TMS Dashboard" subtitle="Project, task, BOM, and procurement overview for the Technical Team.">
        <ErrorState message="Could not load the TMS dashboard — check your connection and try again." onRetry={load} />
      </AppShell>
    );
  }

  return (
    <AppShell title="TMS Dashboard" subtitle="Project, task, BOM, and procurement overview for the Technical Team.">
      <div className={historyStyles.toolbar}>
        <select className={calcStyles.formControl} style={{ width: 'auto' }} value={fDepartment} onChange={(e) => { setFDepartment(e.target.value); setFProject(''); }}>
          <option value="">All departments</option>
          {TMS_DEPARTMENTS.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <select className={calcStyles.formControl} style={{ width: 'auto' }} value={fProject} onChange={(e) => setFProject(e.target.value)}>
          <option value="">All projects</option>
          {(data?.projects || []).filter((p) => !fDepartment || p.department_name === fDepartment).map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <select className={calcStyles.formControl} style={{ width: 'auto' }} value={fAssignee} onChange={(e) => setFAssignee(e.target.value)}>
          <option value="">All assignees</option>
          {assignees.map(([id, name]) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </select>
        <input type="date" className={calcStyles.formControl} style={{ width: 'auto' }} value={fDate} onChange={(e) => setFDate(e.target.value)} />
        <select className={calcStyles.formControl} style={{ width: 'auto' }} value={fTaskStatus} onChange={(e) => setFTaskStatus(e.target.value as TmsTaskStatus | '')}>
          <option value="">All task statuses</option>
          {(Object.keys(TMS_TASK_STATUS_LABEL) as TmsTaskStatus[]).map((s) => (
            <option key={s} value={s}>{TMS_TASK_STATUS_LABEL[s]}</option>
          ))}
        </select>
      </div>

      <div className={dashboardStyles.sectionHeading}>Project Overview</div>
      <div className={dashboardStyles.kpiGrid}>
        <Link href="/tms/projects" className={dashboardStyles.kpiCard}>
          <div className={dashboardStyles.kpiValue}>{projectStats.total}</div>
          <div className={dashboardStyles.kpiLabel}>Total Projects</div>
        </Link>
        <div className={dashboardStyles.kpiCard}>
          <div className={dashboardStyles.kpiValue}>{projectStats.active}</div>
          <div className={dashboardStyles.kpiLabel}>Active Projects</div>
        </div>
        <div className={dashboardStyles.kpiCard}>
          <div className={dashboardStyles.kpiValue}>{projectStats.completed}</div>
          <div className={dashboardStyles.kpiLabel}>Completed Projects</div>
        </div>
        <div className={`${dashboardStyles.kpiCard} ${dashboardStyles.kpiCardAlert}`}>
          <div className={dashboardStyles.kpiValue}>{projectStats.nearDeadline}</div>
          <div className={dashboardStyles.kpiLabel}>Near Deadline</div>
        </div>
        <div className={`${dashboardStyles.kpiCard} ${dashboardStyles.kpiCardAlert}`}>
          <div className={dashboardStyles.kpiValue}>{projectStats.delayed}</div>
          <div className={dashboardStyles.kpiLabel}>Delayed Projects</div>
        </div>
      </div>

      <div className={dashboardStyles.sectionHeading}>Task Overview</div>
      <div className={dashboardStyles.kpiGrid}>
        <Link href="/tms/tasks" className={dashboardStyles.kpiCard}>
          <div className={dashboardStyles.kpiValue}>{taskStats.today}</div>
          <div className={dashboardStyles.kpiLabel}>Today&apos;s Tasks</div>
        </Link>
        <div className={dashboardStyles.kpiCard}>
          <div className={dashboardStyles.kpiValue}>{taskStats.pending}</div>
          <div className={dashboardStyles.kpiLabel}>Pending Tasks</div>
        </div>
        <div className={dashboardStyles.kpiCard}>
          <div className={dashboardStyles.kpiValue}>{taskStats.completedToday}</div>
          <div className={dashboardStyles.kpiLabel}>Completed Today</div>
        </div>
        <div className={`${dashboardStyles.kpiCard} ${dashboardStyles.kpiCardAlert}`}>
          <div className={dashboardStyles.kpiValue}>{taskStats.overdue}</div>
          <div className={dashboardStyles.kpiLabel}>Overdue Tasks</div>
        </div>
      </div>
      {taskStats.byAssignee.length > 0 && (
        <div className={calcStyles.sectionPanel} style={{ marginBottom: 24 }}>
          <div className={calcStyles.h2} style={{ marginTop: 0 }}>Tasks by Assignee</div>
          <table className={historyStyles.table}>
            <thead><tr><th>Assignee</th><th>Tasks</th></tr></thead>
            <tbody>
              {taskStats.byAssignee.map(([name, count]) => (
                <tr key={name}><td>{name}</td><td>{count}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className={dashboardStyles.sectionHeading}>BOM Overview</div>
      <div className={dashboardStyles.kpiGrid}>
        <Link href="/tms/bom-requests" className={dashboardStyles.kpiCard}>
          <div className={dashboardStyles.kpiValue}>{bomStats.pending}</div>
          <div className={dashboardStyles.kpiLabel}>Pending BOM Requests</div>
        </Link>
        <div className={dashboardStyles.kpiCard}>
          <div className={dashboardStyles.kpiValue}>{bomStats.approved}</div>
          <div className={dashboardStyles.kpiLabel}>Approved BOM Requests</div>
        </div>
        <div className={`${dashboardStyles.kpiCard} ${dashboardStyles.kpiCardAlert}`}>
          <div className={dashboardStyles.kpiValue}>{bomStats.awaitingReview}</div>
          <div className={dashboardStyles.kpiLabel}>Awaiting Review</div>
        </div>
      </div>

      <div className={dashboardStyles.sectionHeading}>Procurement Overview</div>
      <div className={dashboardStyles.kpiGrid}>
        <Link href="/tms/procurement" className={dashboardStyles.kpiCard}>
          <div className={dashboardStyles.kpiValue}>{procurementStats.pending}</div>
          <div className={dashboardStyles.kpiLabel}>Pending Procurement</div>
        </Link>
        <div className={`${dashboardStyles.kpiCard} ${dashboardStyles.kpiCardAlert}`}>
          <div className={dashboardStyles.kpiValue}>{procurementStats.approvalPending}</div>
          <div className={dashboardStyles.kpiLabel}>Approval Pending</div>
        </div>
        <div className={dashboardStyles.kpiCard}>
          <div className={dashboardStyles.kpiValue}>{procurementStats.ordered}</div>
          <div className={dashboardStyles.kpiLabel}>Ordered</div>
        </div>
        <div className={dashboardStyles.kpiCard}>
          <div className={dashboardStyles.kpiValue}>{procurementStats.awaitingDelivery}</div>
          <div className={dashboardStyles.kpiLabel}>Awaiting Delivery</div>
        </div>
      </div>
    </AppShell>
  );
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
