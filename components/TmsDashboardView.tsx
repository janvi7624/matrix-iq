'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Clock, FolderKanban, ListChecks } from 'lucide-react';
import { TmsBomRequestRecord, TmsProcurementRecord, TmsProjectRecord, TmsTaskRecord, TmsTaskStatus, UserRole } from '@/lib/types';
import { TMS_DEPARTMENTS } from '@/lib/tmsConstants';
import { TMS_TASK_STATUS_LABEL, todayIso } from '@/lib/tmsLabels';
import AppShell from './AppShell';
import dashboardStyles from './dashboard.module.css';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import ErrorState from './ui/ErrorState';
import EmptyState from './ui/EmptyState';
import TmsGuideModal, { useTmsGuideAutoShow } from './TmsGuideModal';

interface DashboardResponse {
  projects: TmsProjectRecord[];
  tasks: TmsTaskRecord[];
  bomRequests: TmsBomRequestRecord[];
  procurements: TmsProcurementRecord[];
}

interface TmsDashboardViewProps {
  currentUser: { id: string; username: string; name: string; role: UserRole };
}

const MANAGER_TIER_ROLES = new Set<UserRole>(['technical-manager', 'team-lead', 'admin', 'superadmin']);

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good Morning';
  if (hour < 17) return 'Good Afternoon';
  return 'Good Evening';
}

function formatShortDate(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  } catch {
    return iso;
  }
}

const TASK_ROW_TONE: Record<'overdue' | 'due_today' | 'upcoming', { color: string; bg: string }> = {
  overdue: { color: 'var(--mx-danger)', bg: 'var(--mx-danger-subtle)' },
  due_today: { color: 'var(--mx-warning)', bg: 'var(--mx-warning-subtle)' },
  upcoming: { color: 'var(--mx-info)', bg: 'var(--mx-info-subtle)' }
};

function TaskRow({ task, tone, label }: { task: TmsTaskRecord; tone: 'overdue' | 'due_today' | 'upcoming'; label: string }) {
  const t = TASK_ROW_TONE[tone];
  return (
    <Link
      href={`/tms/tasks/${task.id}`}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, textDecoration: 'none',
        padding: '10px 14px', borderRadius: 'var(--mx-radius-md)', background: 'var(--mx-surface)', border: '1px solid var(--mx-border)', borderLeft: `3px solid ${t.color}`
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: t.color, background: t.bg, padding: '1px 8px', borderRadius: 'var(--mx-radius-full)', letterSpacing: 0.3 }}>{label}</span>
          <span style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--mx-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.name}</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--mx-ink-muted)' }}>Project: {task.project_name}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--mx-ink-muted)', flexShrink: 0 }}>
        <Clock size={12} /> {tone === 'due_today' ? 'Today' : formatShortDate(task.due_date)}
      </div>
    </Link>
  );
}

export default function TmsDashboardView({ currentUser }: TmsDashboardViewProps) {
  const isManagerTier = MANAGER_TIER_ROLES.has(currentUser.role);
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [autoShowGuide, dismissAutoGuide] = useTmsGuideAutoShow();
  const [showGuide, setShowGuide] = useState(false);

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

  // "My Work" — the personalized section every TMS view was missing (see
  // components/TmsDashboardView.tsx's history: every Tms*View used to
  // receive currentUser and discard it). Computed from the SAME already-
  // fetched data.projects/data.tasks — no extra API call. For a non-manager,
  // data.tasks is already server-scoped to "assignee or creator = me"
  // (lib/tmsTaskStore.ts), so myTasks below is just a tighter
  // assignee-only filter of what's already theirs; for a manager (who sees
  // every task), it's the real personal subset.
  const myProjects = useMemo(() => {
    if (!data) return [];
    return data.projects.filter((p) => p.project_manager_id === currentUser.id || p.team_member_ids.includes(currentUser.id));
  }, [data, currentUser.id]);

  const myTasks = useMemo(() => {
    if (!data) return [];
    return data.tasks.filter((t) => t.assignee_id === currentUser.id);
  }, [data, currentUser.id]);

  const myWorkStats = useMemo(() => {
    const date = todayIso();
    const weekAgo = addDays(date, -7);
    const activeProjects = myProjects.filter((p) => p.status !== 'completed' && p.status !== 'cancelled');
    const activeTask = (t: TmsTaskRecord) => t.status !== 'completed' && t.status !== 'cancelled';
    return {
      activeProjects: activeProjects.length,
      myTasks: myTasks.length,
      dueToday: myTasks.filter((t) => activeTask(t) && t.due_date === date).length,
      overdue: myTasks.filter((t) => activeTask(t) && t.due_date && t.due_date < date).length,
      completedThisWeek: myTasks.filter((t) => t.completion_date && t.completion_date >= weekAgo && t.completion_date <= date).length
    };
  }, [myProjects, myTasks]);

  const myTaskBuckets = useMemo(() => {
    const date = todayIso();
    const activeTask = (t: TmsTaskRecord) => t.status !== 'completed' && t.status !== 'cancelled';
    const overdue = myTasks.filter((t) => activeTask(t) && t.due_date && t.due_date < date).sort((a, b) => a.due_date.localeCompare(b.due_date));
    const dueToday = myTasks.filter((t) => activeTask(t) && t.due_date === date);
    const upcoming = myTasks.filter((t) => activeTask(t) && t.due_date && t.due_date > date).sort((a, b) => a.due_date.localeCompare(b.due_date));
    return { overdue, dueToday, upcoming };
  }, [myTasks]);

  // The single most urgent thing to do next — "reduce confusion" per the
  // request's own framing, so this is deliberately ONE task, not a list.
  const nextAction = myTaskBuckets.overdue[0] || myTaskBuckets.dueToday[0] || null;

  // Manager Team Overview (request section 17) — shown only to
  // technical-manager/team-lead/privileged, who already receive the full
  // unfiltered dashboard pool (see lib/tmsTaskStore.ts's canManageAllTmsTasks/
  // lib/tmsProjectStore.ts's unfiltered list()), so this is purely a
  // client-side re-grouping of data already on the page — no new API call.
  const teamWorkload = useMemo(() => {
    if (!isManagerTier || !data) return [];
    const byAssignee = new Map<string, { id: string; name: string; projects: Set<string>; tasks: number; overdue: number }>();
    const date = todayIso();
    data.tasks.forEach((t) => {
      if (!t.assignee_id) return;
      const entry = byAssignee.get(t.assignee_id) || { id: t.assignee_id, name: t.assignee_name || 'Unknown', projects: new Set<string>(), tasks: 0, overdue: 0 };
      entry.tasks += 1;
      if (t.status !== 'completed' && t.status !== 'cancelled' && t.due_date && t.due_date < date) entry.overdue += 1;
      entry.projects.add(t.project_id);
      byAssignee.set(t.assignee_id, entry);
    });
    data.projects.forEach((p) => {
      [p.project_manager_id, ...p.team_member_ids].forEach((uid) => {
        if (!uid) return;
        const entry = byAssignee.get(uid);
        if (entry) entry.projects.add(p.id);
      });
    });
    return Array.from(byAssignee.values())
      .map((e) => ({ id: e.id, name: e.name, projectCount: e.projects.size, tasks: e.tasks, overdue: e.overdue }))
      .sort((a, b) => b.overdue - a.overdue || b.tasks - a.tasks);
  }, [isManagerTier, data]);

  const teamOverviewStats = useMemo(() => {
    if (!isManagerTier || !data) return null;
    const activeProjects = data.projects.filter((p) => p.status !== 'completed' && p.status !== 'cancelled');
    const pendingTasks = data.tasks.filter((t) => t.status === 'to_do' || t.status === 'in_progress' || t.status === 'on_hold');
    const date = todayIso();
    const overdueTasks = data.tasks.filter((t) => t.status !== 'completed' && t.status !== 'cancelled' && t.due_date && t.due_date < date);
    return { engineers: teamWorkload.length, activeProjects: activeProjects.length, pendingTasks: pendingTasks.length, overdueTasks: overdueTasks.length };
  }, [isManagerTier, data, teamWorkload]);

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
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--mx-ink)' }}>{greeting()}, {currentUser.name || currentUser.username}</div>
        <button type="button" onClick={() => setShowGuide(true)} style={{ background: 'none', border: 'none', color: 'var(--mx-brand)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', padding: 0 }}>
          How TMS Works
        </button>
      </div>
      <div className={calcStyles.h2} style={{ marginTop: 0, marginBottom: 10 }}>Your Technical Work</div>
      {(autoShowGuide || showGuide) && (
        <TmsGuideModal
          onClose={() => {
            dismissAutoGuide();
            setShowGuide(false);
          }}
        />
      )}
      <div className={historyStyles.summaryCardGrid}>
        <div className={historyStyles.summaryCard}>
          <div className={historyStyles.summaryCardLabel}>Active Projects</div>
          <div className={historyStyles.summaryCardValue}>{myWorkStats.activeProjects}</div>
        </div>
        <div className={historyStyles.summaryCard}>
          <div className={historyStyles.summaryCardLabel}>My Tasks</div>
          <div className={historyStyles.summaryCardValue}>{myWorkStats.myTasks}</div>
        </div>
        <div className={historyStyles.summaryCard} style={myWorkStats.dueToday ? { background: 'var(--mx-warning-subtle)' } : undefined}>
          <div className={historyStyles.summaryCardLabel}>Due Today</div>
          <div className={historyStyles.summaryCardValue}>{myWorkStats.dueToday}</div>
        </div>
        <div className={historyStyles.summaryCard} style={myWorkStats.overdue ? { background: 'var(--mx-danger-subtle)' } : undefined}>
          <div className={historyStyles.summaryCardLabel}>Overdue</div>
          <div className={historyStyles.summaryCardValue}>{myWorkStats.overdue}</div>
        </div>
        <div className={historyStyles.summaryCard}>
          <div className={historyStyles.summaryCardLabel}>Completed This Week</div>
          <div className={historyStyles.summaryCardValue}>{myWorkStats.completedThisWeek}</div>
        </div>
      </div>

      <div className={calcStyles.sectionPanel} style={{ marginTop: 16, marginBottom: 20, borderLeft: nextAction ? '3px solid var(--mx-brand)' : '3px solid var(--mx-success)' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--mx-ink-faint)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>Next Action</div>
        {nextAction ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                <AlertTriangle size={15} color={myTaskBuckets.overdue[0] === nextAction ? 'var(--mx-danger)' : 'var(--mx-warning)'} />
                <span style={{ fontWeight: 700, fontSize: 14.5 }}>{nextAction.name}</span>
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--mx-ink-muted)' }}>
                {nextAction.project_name} · {myTaskBuckets.overdue[0] === nextAction ? `Overdue — was due ${nextAction.due_date}` : 'Due today'}
              </div>
            </div>
            <Link className={calcStyles.btn} href={`/tms/tasks/${nextAction.id}`}>Open Task</Link>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--mx-success)', fontWeight: 600 }}>
            <CheckCircle2 size={18} /> You&apos;re all caught up. No overdue or due-today tasks.
          </div>
        )}
      </div>

      <div className={dashboardStyles.sectionHeading}>My Projects</div>
      {myProjects.length === 0 ? (
        <EmptyState icon={FolderKanban} title="No Projects Assigned" message="Projects assigned to you will appear here. You currently have no active technical projects." />
      ) : (
        <div className={historyStyles.tableWrap} style={{ marginBottom: 20 }}>
          <table className={historyStyles.table}>
            <thead><tr><th>Project</th><th>Role</th><th>Progress</th><th></th></tr></thead>
            <tbody>
              {myProjects.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.project_manager_id === currentUser.id ? 'Project Manager' : 'Engineer'}</td>
                  <td>
                    <div className={historyStyles.progressTrack}><div className={historyStyles.progressFill} style={{ width: `${p.progress_percent}%` }} /></div>
                    <div className={historyStyles.progressLabel}>{p.progress_percent}%</div>
                  </td>
                  <td><Link className={historyStyles.button} href={`/tms/projects/${p.id}`}>View Project</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className={dashboardStyles.sectionHeading}>My Tasks</div>
      {myTasks.length === 0 ? (
        <EmptyState icon={ListChecks} title="No Tasks Assigned" message="You're currently all caught up." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
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

      {isManagerTier && teamOverviewStats && (
        <>
          <div className={dashboardStyles.sectionHeading}>Team Overview</div>
          <div className={dashboardStyles.kpiGrid}>
            <div className={dashboardStyles.kpiCard}>
              <div className={dashboardStyles.kpiValue}>{teamOverviewStats.engineers}</div>
              <div className={dashboardStyles.kpiLabel}>Engineers</div>
            </div>
            <div className={dashboardStyles.kpiCard}>
              <div className={dashboardStyles.kpiValue}>{teamOverviewStats.activeProjects}</div>
              <div className={dashboardStyles.kpiLabel}>Active Projects</div>
            </div>
            <div className={dashboardStyles.kpiCard}>
              <div className={dashboardStyles.kpiValue}>{teamOverviewStats.pendingTasks}</div>
              <div className={dashboardStyles.kpiLabel}>Pending Tasks</div>
            </div>
            <div className={`${dashboardStyles.kpiCard} ${dashboardStyles.kpiCardAlert}`}>
              <div className={dashboardStyles.kpiValue}>{teamOverviewStats.overdueTasks}</div>
              <div className={dashboardStyles.kpiLabel}>Overdue Tasks</div>
            </div>
          </div>
          {teamWorkload.length > 0 && (
            <div className={calcStyles.sectionPanel} style={{ marginBottom: 20 }}>
              <div className={calcStyles.h2} style={{ marginTop: 0 }}>Team Workload</div>
              <div className={historyStyles.tableWrap}>
                <table className={historyStyles.table}>
                  <thead><tr><th>Engineer</th><th>Projects</th><th>Tasks</th><th>Overdue</th></tr></thead>
                  <tbody>
                    {teamWorkload.map((w) => (
                      <tr
                        key={w.id}
                        style={{ cursor: 'pointer' }}
                        onClick={() => setFAssignee((v) => (v === w.id ? '' : w.id))}
                      >
                        <td style={{ fontWeight: fAssignee === w.id ? 700 : 400 }}>{w.name}</td>
                        <td>{w.projectCount}</td>
                        <td>{w.tasks}</td>
                        <td style={w.overdue ? { color: 'var(--mx-danger)', fontWeight: 700 } : undefined}>{w.overdue}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

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
