'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AppShell from './AppShell';
import StatusBadge from './ui/StatusBadge';
import PriorityBadge from './ui/PriorityBadge';
import { TmsProjectRecord, TmsTaskRecord } from '@/lib/types';
import {
  TMS_PROJECT_STATUS_LABEL, TMS_PROJECT_STATUS_TONE,
  TMS_TASK_STATUS_LABEL, TMS_TASK_STATUS_TONE,
  TMS_PRIORITY_LABEL, TMS_PRIORITY_TONE
} from '@/lib/tmsLabels';
import historyStyles from './quotationHistory.module.css';
import styles from './mySoldProjects.module.css';

function formatDate(value: string): string {
  if (!value) return '—';
  try { return new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return value; }
}

interface Payload {
  project: TmsProjectRecord;
  tasks: TmsTaskRecord[];
}

// Read-only project + full task list, for the Sales side — the detail
// counterpart to MySoldProjectsView. No edit/assign/status controls exist
// here at all (not just hidden): this component never calls a write route.
export default function MySoldProjectDetailView({ id }: { id: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/tms/my-sales-projects/${id}`);
        const body = await res.json().catch(() => null);
        if (!res.ok) { setError(body?.error || 'Could not load this project.'); return; }
        setData(body);
      } catch {
        setError('Could not reach the server.');
      }
    })();
  }, [id]);

  if (error) {
    return (
      <AppShell title="My Sold Projects" subtitle="TMS status — read-only">
        <div className={styles.pageWrap}>
          <div className={historyStyles.loginError}>{error}</div>
          <Link className={historyStyles.button} href="/tms/my-sold-projects">← Back to My Sold Projects</Link>
        </div>
      </AppShell>
    );
  }

  if (!data) {
    return (
      <AppShell title="My Sold Projects" subtitle="TMS status — read-only">
        <div className={styles.pageWrap}><div className={historyStyles.status}>Loading…</div></div>
      </AppShell>
    );
  }

  const { project, tasks } = data;

  return (
    <AppShell title={project.name} subtitle={`TMS status for a deal you sold — read-only`}>
      <div className={styles.pageWrap}>
        <div className={styles.backLink}>
          <Link className={historyStyles.button} href="/tms/my-sold-projects">← Back to My Sold Projects</Link>
        </div>

        <div className={styles.readOnlyNote}>
          Read-only — this is the Technical Team's own view into their work on your deal. To change anything here, contact the project's team.
        </div>

        <div className={styles.headRow}>
          <div>
            <div className={styles.headTitle}>{project.name}</div>
            <div className={styles.headCode}>{project.project_code} {project.client_name ? `· ${project.client_name}` : ''}</div>
          </div>
          <div className={styles.headBadges}>
            <StatusBadge tone={TMS_PROJECT_STATUS_TONE[project.status]} label={TMS_PROJECT_STATUS_LABEL[project.status]} />
            <PriorityBadge tone={TMS_PRIORITY_TONE[project.priority]} label={TMS_PRIORITY_LABEL[project.priority]} />
          </div>
        </div>

        <div className={styles.detailGrid}>
          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>Department</span>
            <span className={styles.detailValue}>{project.department_names.length ? project.department_names.join(', ') : project.department_name || '—'}</span>
          </div>
          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>Progress</span>
            <span className={styles.detailValue}>{project.progress_percent}%</span>
          </div>
          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>Project Manager</span>
            <span className={styles.detailValue}>{project.project_manager_name || '—'}</span>
          </div>
          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>Team</span>
            <span className={styles.detailValue}>{project.team_member_names.length ? project.team_member_names.join(', ') : '—'}</span>
          </div>
          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>Start Date</span>
            <span className={styles.detailValue}>{formatDate(project.start_date)}</span>
          </div>
          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>Deadline</span>
            <span className={styles.detailValue}>{formatDate(project.deadline)}</span>
          </div>
          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>Estimated Close</span>
            <span className={styles.detailValue}>{formatDate(project.estimated_close_date)}</span>
          </div>
          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>Actual Close</span>
            <span className={styles.detailValue}>{formatDate(project.actual_close_date)}</span>
          </div>
          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>Sold By</span>
            <span className={styles.detailValue}>{project.sales_person_name || project.sales_person_username || '—'}</span>
          </div>
        </div>

        {project.description && (
          <div className={styles.detailItem} style={{ marginBottom: 20 }}>
            <span className={styles.detailLabel}>Description</span>
            <span className={styles.detailValue}>{project.description}</span>
          </div>
        )}

        <div className={styles.sectionTitle}>Tasks ({tasks.length})</div>
        {tasks.length === 0 ? (
          <div className={historyStyles.empty}>No tasks logged on this project yet.</div>
        ) : (
          <div className={historyStyles.tableWrap}>
            <table className={`${historyStyles.table} ${historyStyles.tableFixed}`}>
              <thead>
                <tr>
                  <th>Task</th>
                  <th className={styles.colDept}>Assignee</th>
                  <th className={styles.colStatus}>Status</th>
                  <th className={styles.colPriority}>Priority</th>
                  <th className={styles.colProgress}>Progress</th>
                  <th className={styles.colDate}>Due</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.id}>
                    <td>{t.name}</td>
                    <td>{t.assignee_name || '—'}</td>
                    <td><StatusBadge tone={TMS_TASK_STATUS_TONE[t.status]} label={TMS_TASK_STATUS_LABEL[t.status]} /></td>
                    <td><PriorityBadge tone={TMS_PRIORITY_TONE[t.priority]} label={TMS_PRIORITY_LABEL[t.priority]} /></td>
                    <td>
                      <span className={styles.taskProgressBar}>
                        <span className={styles.taskProgressFill} style={{ width: `${t.progress_percent}%` }} />
                      </span>
                      {t.progress_percent}%
                    </td>
                    <td className={styles.nowrap}>{formatDate(t.due_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
