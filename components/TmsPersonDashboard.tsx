'use client';

import { useEffect, useState } from 'react';
import Modal, { ModalOkButton } from './ui/Modal';
import ErrorState from './ui/ErrorState';
import { SkeletonRows } from './ui/Skeleton';
import { TMS_ROLE_LABEL } from '@/lib/tmsLabels';
import styles from './departmentHealthDetail.module.css';

interface TmsPersonDashboardData {
  user: { id: string; username: string; name: string; department: string; designation: string; role: string };
  projects: { assigned: number; active: number; completed: number };
  tasks: { total: number; completed: number; inProgress: number; blocked: number; pending: number; overdue: number };
  taskDerivedProgress: number | null;
  recentUpdates: { id: string; taskName: string; progressPercent: number; statusAtUpdate: string; remark: string; updatedByName: string; createdAt: string }[];
}

interface TmsPersonDashboardProps {
  userId: string;
  onClose: () => void;
}

function formatDateTime(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('en-IN');
  } catch {
    return iso;
  }
}

// TMS-specific counterpart to components/PersonPerformanceDashboard.tsx —
// same Modal size="full" + totalsGrid/totalCard shape (departmentHealthDetail
// .module.css), backed by GET /api/tms/users/[id]/dashboard instead of the
// Sales-side /api/dashboard/person/[username].
export default function TmsPersonDashboard({ userId, onClose }: TmsPersonDashboardProps) {
  const [data, setData] = useState<TmsPersonDashboardData | null>(null);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError('');
    fetch(`/api/tms/users/${encodeURIComponent(userId)}/dashboard`)
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 403 ? 'You do not have access to this person’s data.' : `Server responded with ${r.status}`);
        return r.json();
      })
      .then((json: TmsPersonDashboardData) => {
        if (!cancelled) setData(json);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message || 'Could not load this person’s dashboard.');
      });
    return () => {
      cancelled = true;
    };
  }, [userId, reloadKey]);

  return (
    <Modal
      title={
        data ? (
          <>
            {data.user.name || data.user.username}
            <div className={styles.personSubtitle}>{[data.user.department, TMS_ROLE_LABEL[data.user.role] || data.user.role, data.user.designation].filter(Boolean).join(' · ')}</div>
          </>
        ) : (
          'Team Member'
        )
      }
      ariaLabel="TMS person dashboard"
      onClose={onClose}
      size="full"
      footer={<ModalOkButton onClick={onClose}>Close</ModalOkButton>}
    >
      {error ? (
        <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
      ) : !data ? (
        <div className={styles.loadingWrap}><SkeletonRows rows={5} columns={3} /></div>
      ) : (
        <>
          <h3 className={styles.sectionTitle}>Projects</h3>
          <div className={styles.totalsGrid}>
            <div className={styles.totalCard}>
              <div className={styles.totalValue}>{data.projects.assigned}</div>
              <div className={styles.totalLabel}>Assigned</div>
            </div>
            <div className={styles.totalCard}>
              <div className={styles.totalValue}>{data.projects.active}</div>
              <div className={styles.totalLabel}>Active</div>
            </div>
            <div className={styles.totalCard}>
              <div className={styles.totalValue}>{data.projects.completed}</div>
              <div className={styles.totalLabel}>Completed</div>
            </div>
          </div>

          <h3 className={styles.sectionTitle}>Tasks{data.taskDerivedProgress !== null ? ` — ${data.taskDerivedProgress}% complete` : ''}</h3>
          {data.tasks.total === 0 ? (
            <p className={styles.emptyNote}>No tasks assigned in TMS.</p>
          ) : (
            <div className={styles.totalsGrid}>
              <div className={styles.totalCard}>
                <div className={styles.totalValue}>{data.tasks.total}</div>
                <div className={styles.totalLabel}>Total</div>
              </div>
              <div className={styles.totalCard}>
                <div className={styles.totalValue}>{data.tasks.completed}</div>
                <div className={styles.totalLabel}>Completed</div>
              </div>
              <div className={styles.totalCard}>
                <div className={styles.totalValue}>{data.tasks.inProgress}</div>
                <div className={styles.totalLabel}>In Progress</div>
              </div>
              <div className={styles.totalCard}>
                <div className={styles.totalValue}>{data.tasks.blocked}</div>
                <div className={styles.totalLabel}>Blocked</div>
              </div>
              <div className={styles.totalCard}>
                <div className={styles.totalValue}>{data.tasks.overdue}</div>
                <div className={styles.totalLabel}>Overdue</div>
              </div>
            </div>
          )}

          <h3 className={styles.sectionTitle}>Recent Activity</h3>
          {data.recentUpdates.length === 0 ? (
            <p className={styles.emptyNote}>No progress updates yet.</p>
          ) : (
            <ul className={styles.memberList}>
              {data.recentUpdates.map((u) => (
                <li key={u.id}>
                  <div className={styles.member}>
                    <div className={styles.memberBody}>
                      <div className={styles.memberTop}>
                        <span className={styles.memberName}>{u.taskName} — {u.progressPercent}%</span>
                        <span className={styles.memberDesignation}>{formatDateTime(u.createdAt)}</span>
                      </div>
                      {u.remark && <div>{u.remark}</div>}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Modal>
  );
}
