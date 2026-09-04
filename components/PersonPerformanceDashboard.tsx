'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Modal, { ModalOkButton } from './ui/Modal';
import StatusBadge, { StatusTone } from './ui/StatusBadge';
import ErrorState from './ui/ErrorState';
import { SkeletonRows } from './ui/Skeleton';
import { STAGE_LABEL } from '@/lib/projectStages';
import { formatMoney } from '@/lib/format';
import styles from './departmentHealthDetail.module.css';

const TARGET_STATUS_LABEL: Record<string, string> = {
  not_started: 'Not Started',
  on_track: 'On Track',
  at_risk: 'At Risk',
  achieved: 'Achieved',
  exceeded: 'Exceeded'
};

interface MetricRow { label: string; value: string; }

// Shape returned by app/api/dashboard/person/[username]/route.ts — a subset
// of lib/performanceReview.ts's PerformanceReview actually shown here (the
// full payload also carries a detailed timeline/chart series the admin
// Performance Review page uses; this modal sticks to the summary counts
// that answer "how is this person doing" at a glance).
interface PersonReview {
  user: { username: string; name: string; department: string; designation: string };
  crm: { wonLeads: number; lostLeads: number; unattendedLeads: number };
  sales: { quotationsCreated: number; quotationsConverted: number };
  projects: { assignedProjects: number; activeProjects: number; completedProjects: number };
  projectsList: { id: string; label: string; stage: string; status: string }[];
  tasks: { total: number; completed: number; pending: number };
  followUps: { pending: number; completed: number; overdue: number };
  // Only present when the viewer can manage targets (lib/targetAccess.ts's
  // canManageTargets) — absent entirely for a normal employee viewing their
  // own dashboard, or a viewer without target access.
  target?: { periodType: string; displayPeriod: string; targetAmount: number; achievedAmount: number; achievementPercent: number; status: string } | null;
}

interface PersonPerformanceDashboardProps {
  username: string;
  name: string;
  department: string;
  designation: string;
  // The score/metrics already computed for this person by the department
  // health scorer (lib/departmentScoring.ts) — passed down from
  // DepartmentHealthDetail rather than recomputed, since that's the same
  // "pipeline contribution" figure already shown on screen.
  score: number | null;
  metrics: MetricRow[];
  onClose: () => void;
}

export default function PersonPerformanceDashboard({ username, name, department, designation, score, metrics, onClose }: PersonPerformanceDashboardProps) {
  const [data, setData] = useState<PersonReview | null>(null);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError('');
    fetch(`/api/dashboard/person/${encodeURIComponent(username)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 403 ? 'You do not have access to this person’s data.' : `Server responded with ${r.status}`);
        return r.json();
      })
      .then((json: PersonReview) => {
        if (!cancelled) setData(json);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message || 'Could not load this person’s dashboard.');
      });
    return () => {
      cancelled = true;
    };
  }, [username, reloadKey]);

  return (
    <Modal
      title={
        <>
          {name || username}
          <div className={styles.personSubtitle}>{[department, designation].filter(Boolean).join(' · ') || 'No department on file'}</div>
        </>
      }
      ariaLabel={`Performance dashboard for ${name || username}`}
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
          {metrics.length > 0 && (
            <>
              <h3 className={styles.sectionTitle}>Pipeline contribution{score !== null ? ` — ${score}%` : ''}</h3>
              <div className={styles.totalsGrid}>
                {metrics.map((m) => (
                  <div key={m.label} className={styles.totalCard}>
                    <div className={styles.totalValue}>{m.value}</div>
                    <div className={styles.totalLabel}>{m.label}</div>
                  </div>
                ))}
              </div>
            </>
          )}

          {data.target && (
            <>
              <h3 className={styles.sectionTitle}>Target vs Achievement — {data.target.displayPeriod}</h3>
              <div className={styles.totalsGrid}>
                <div className={styles.totalCard}>
                  <div className={styles.totalValue}>{formatMoney(data.target.targetAmount)}</div>
                  <div className={styles.totalLabel}>Target</div>
                </div>
                <div className={styles.totalCard}>
                  <div className={styles.totalValue}>{formatMoney(data.target.achievedAmount)}</div>
                  <div className={styles.totalLabel}>Achieved</div>
                </div>
                <div className={styles.totalCard}>
                  <div className={styles.totalValue}>{data.target.achievementPercent}%</div>
                  <div className={styles.totalLabel}>Achievement</div>
                </div>
                <div className={styles.totalCard}>
                  <StatusBadge tone={data.target.status === 'achieved' ? 'won' : (data.target.status as StatusTone)} label={TARGET_STATUS_LABEL[data.target.status] || data.target.status} />
                  <div className={styles.totalLabel}>Status</div>
                </div>
              </div>
            </>
          )}

          <h3 className={styles.sectionTitle}>Projects</h3>
          <div className={styles.totalsGrid}>
            <div className={styles.totalCard}>
              <div className={styles.totalValue}>{data.projects.assignedProjects}</div>
              <div className={styles.totalLabel}>Assigned</div>
            </div>
            <div className={styles.totalCard}>
              <div className={styles.totalValue}>{data.projects.activeProjects}</div>
              <div className={styles.totalLabel}>Active</div>
            </div>
            <div className={styles.totalCard}>
              <div className={styles.totalValue}>{data.projects.completedProjects}</div>
              <div className={styles.totalLabel}>Completed</div>
            </div>
            <div className={styles.totalCard}>
              <div className={styles.totalValue}>{data.crm.wonLeads} / {data.crm.lostLeads}</div>
              <div className={styles.totalLabel}>Won / Lost</div>
            </div>
          </div>

          <h3 className={styles.sectionTitle}>Tasks</h3>
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
                <div className={styles.totalValue}>{data.tasks.pending}</div>
                <div className={styles.totalLabel}>Pending</div>
              </div>
            </div>
          )}

          <h3 className={styles.sectionTitle}>Quotations &amp; follow-ups</h3>
          <div className={styles.totalsGrid}>
            <div className={styles.totalCard}>
              <div className={styles.totalValue}>{data.sales.quotationsCreated}</div>
              <div className={styles.totalLabel}>Quotations created</div>
            </div>
            <div className={styles.totalCard}>
              <div className={styles.totalValue}>{data.sales.quotationsConverted}</div>
              <div className={styles.totalLabel}>Converted</div>
            </div>
            <div className={styles.totalCard}>
              <div className={styles.totalValue}>{data.followUps.pending}</div>
              <div className={styles.totalLabel}>Follow-ups pending</div>
            </div>
            <div className={styles.totalCard}>
              <div className={styles.totalValue}>{data.followUps.overdue}</div>
              <div className={styles.totalLabel}>Follow-ups overdue</div>
            </div>
          </div>

          <h3 className={styles.sectionTitle}>Project status ({data.projectsList.length})</h3>
          {data.projectsList.length === 0 ? (
            <p className={styles.emptyNote}>No projects assigned to this person yet.</p>
          ) : (
            <ul className={styles.memberList}>
              {data.projectsList.map((p) => (
                <li key={p.id}>
                  <Link href={`/projects/${p.id}`} className={styles.memberLink}>
                    <div className={styles.member}>
                      <div className={styles.memberBody}>
                        <div className={styles.memberTop}>
                          <span className={styles.memberName}>{p.label}</span>
                          {p.status === 'won' || p.status === 'lost' ? (
                            <StatusBadge tone={p.status} label={p.status === 'lost' ? 'Closed Lost' : 'Won'} />
                          ) : (
                            <span className={styles.memberDesignation}>{STAGE_LABEL[p.stage as keyof typeof STAGE_LABEL] || p.stage}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Modal>
  );
}
