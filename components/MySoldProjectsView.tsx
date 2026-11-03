'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from './AppShell';
import StatusBadge from './ui/StatusBadge';
import PriorityBadge from './ui/PriorityBadge';
import { TmsProjectRecord } from '@/lib/types';
import { TMS_PROJECT_STATUS_LABEL, TMS_PROJECT_STATUS_TONE, TMS_PRIORITY_LABEL, TMS_PRIORITY_TONE } from '@/lib/tmsLabels';
import historyStyles from './quotationHistory.module.css';
import styles from './mySoldProjects.module.css';

function formatDate(value: string): string {
  if (!value) return '—';
  try { return new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return value; }
}

// Read-only: the Sales side's own window into TMS — every project tied to a
// deal this viewer sold (or their whole team's, if they manage Sales). See
// lib/tmsSalesVisibility.ts for the scoping rule; this component never
// writes anything, it only lists and links to the matching read-only detail.
export default function MySoldProjectsView({ currentUser }: { currentUser: { name: string } }) {
  const router = useRouter();
  const [projects, setProjects] = useState<TmsProjectRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/tms/my-sales-projects');
        const data = await res.json().catch(() => null);
        if (!res.ok) { setError(data?.error || 'Could not load your sold projects.'); return; }
        setProjects(data.projects || []);
      } catch {
        setError('Could not reach the server.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <AppShell title="My Sold Projects" subtitle={`TMS status for projects ${currentUser.name} sold — read-only.`}>
      <div className={styles.pageWrap}>
        {error && <div className={historyStyles.loginError}>{error}</div>}

        {loading ? (
          <div className={historyStyles.status}>Loading…</div>
        ) : projects.length === 0 ? (
          <div className={historyStyles.empty}>
            No TMS projects yet. A project appears here once a deal you sold is assigned to the Technical Team.
          </div>
        ) : (
          <div className={historyStyles.tableWrap}>
            <table className={`${historyStyles.table} ${historyStyles.tableFixed}`}>
              <thead>
                <tr>
                  <th className={styles.colCode}>Code</th>
                  <th>Project</th>
                  <th className={styles.colDept}>Department</th>
                  <th className={styles.colStatus}>Status</th>
                  <th className={styles.colPriority}>Priority</th>
                  <th className={styles.colProgress}>Progress</th>
                  <th className={styles.colDate}>Deadline</th>
                  <th className={styles.colSales}>Sold By</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id} className={styles.clickableRow} onClick={() => router.push(`/tms/my-sold-projects/${p.id}`)}>
                    <td className={styles.nowrap}>{p.project_code || '—'}</td>
                    <td>
                      <div className={styles.projectNameCell}>{p.name}</div>
                      {p.client_name && <div className={styles.fieldHint}>{p.client_name}</div>}
                    </td>
                    <td>{p.department_names.length ? p.department_names.join(', ') : p.department_name || '—'}</td>
                    <td><StatusBadge tone={TMS_PROJECT_STATUS_TONE[p.status]} label={TMS_PROJECT_STATUS_LABEL[p.status]} /></td>
                    <td><PriorityBadge tone={TMS_PRIORITY_TONE[p.priority]} label={TMS_PRIORITY_LABEL[p.priority]} /></td>
                    <td>{p.progress_percent}%</td>
                    <td className={styles.nowrap}>{formatDate(p.deadline)}</td>
                    <td>{p.sales_person_name || p.sales_person_username || '—'}</td>
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
