'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Modal, { ModalOkButton } from './ui/Modal';
import StatusBadge, { StatusTone } from './ui/StatusBadge';
import ErrorState from './ui/ErrorState';
import { SkeletonRows } from './ui/Skeleton';
import { STAGE_LABEL } from '@/lib/projectStages';
import { TMS_TASK_STATUS_LABEL } from '@/lib/tmsLabels';
import { FOLLOW_UP_DAYS } from '@/lib/followUp';
import { formatMoney } from '@/lib/format';
import styles from './departmentHealthDetail.module.css';

const TARGET_STATUS_LABEL: Record<string, string> = {
  not_started: 'Not Started',
  on_track: 'On Track',
  at_risk: 'At Risk',
  achieved: 'Achieved',
  exceeded: 'Exceeded'
};

interface DrilldownItem { id: string; label: string; sublabel: string; href: string }
interface MetricRow { label: string; value: string; items?: DrilldownItem[]; }

// Shape returned by app/api/dashboard/person/[username]/route.ts — a subset
// of lib/performanceReview.ts's PerformanceReview actually shown here (the
// full payload also carries a detailed timeline/chart series the admin
// Performance Review page uses; this modal sticks to the summary counts
// that answer "how is this person doing" at a glance).
interface PersonReview {
  user: { username: string; name: string; department: string; designation: string };
  // `crm` counts LEADS assigned to this person (lib/performanceReview.ts) —
  // the call funnel, not projects. wonLeads/lostLeads are kept for the admin
  // Performance Review page; this modal shows the funnel below instead.
  crm: {
    totalLeads: number;
    qualifiedLeads: number;
    lostLeads: number;
    wonLeads: number;
    calledLeads: number;
    awaitingCallLeads: number;
    callbacksDue: number;
    unattendedLeads: number;
    capturedLeads: number;
  };
  sales: { quotationsCreated: number; quotationsConverted: number };
  projects: { assignedProjects: number; activeProjects: number; completedProjects: number; wonProjects: number; lostProjects: number };
  projectsList: { id: string; label: string; stage: string; status: string }[];
  tasks: { total: number; completed: number; pending: number };
  tasksList: { id: string; label: string; status: string; dueDate: string; projectName: string }[];
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
  // Which Tasks tile was clicked — filters the task list below it. Defaults
  // to unset (list hidden) so this panel doesn't grow by default; clicking
  // Total/Completed/Pending both narrows and reveals the list.
  const [taskFilter, setTaskFilter] = useState<'total' | 'completed' | 'pending' | null>(null);
  // Same idea for the Pipeline contribution tiles — keyed by the metric's
  // own label since these vary per department (lib/departmentScoring.ts).
  const [metricFilter, setMetricFilter] = useState<string | null>(null);

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
              <h3 className={styles.sectionTitle}>
                Pipeline contribution{score !== null ? ` — ${score}%` : ''}
                {metrics.some((m) => m.items && m.items.length > 0) ? (metricFilter ? ' — click a tile again to hide the list' : ' — click a tile to see what it counts') : ''}
              </h3>
              <div className={styles.totalsGrid}>
                {metrics.map((m) =>
                  m.items && m.items.length > 0 ? (
                    <button
                      key={m.label}
                      type="button"
                      className={`${styles.totalCard} ${styles.totalCardClickable} ${metricFilter === m.label ? styles.totalCardActive : ''}`}
                      onClick={() => setMetricFilter((f) => (f === m.label ? null : m.label))}
                    >
                      <div className={styles.totalValue}>{m.value}</div>
                      <div className={styles.totalLabel}>{m.label}</div>
                    </button>
                  ) : (
                    <div key={m.label} className={styles.totalCard}>
                      <div className={styles.totalValue}>{m.value}</div>
                      <div className={styles.totalLabel}>{m.label}</div>
                    </div>
                  )
                )}
              </div>
              {metricFilter && (() => {
                const items = metrics.find((m) => m.label === metricFilter)?.items || [];
                return items.length === 0 ? null : (
                  <ul className={styles.memberList}>
                    {items.map((item) => (
                      <li key={item.id}>
                        <Link href={item.href} className={styles.memberLink}>
                          <div className={styles.member}>
                            <div className={styles.memberBody}>
                              <div className={styles.memberTop}>
                                <span className={styles.memberName}>{item.label}</span>
                                {item.sublabel && <span className={styles.memberDesignation}>{item.sublabel}</span>}
                              </div>
                            </div>
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                );
              })()}
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
              {/* Project win/loss — was reading crm.wonLeads/lostLeads, which
                  now count leads (qualified / ruled out on the call), not
                  deals. Same numbers as before, from the project side. */}
              <div className={styles.totalValue}>{data.projects.wonProjects} / {data.projects.lostProjects}</div>
              <div className={styles.totalLabel}>Won / Lost</div>
            </div>
          </div>

          {/* The qualification call is where a lead's life is decided now
              (assign -> call -> only 'suitable' becomes a project), so this
              is the honest picture of a rep's lead work — a project count
              alone would show nothing for the 600 cards they rang and
              correctly ruled out. Captured is shown separately because
              scanning a card and working one are different jobs. */}
          <h3 className={styles.sectionTitle}>Leads assigned</h3>
          {data.crm.totalLeads === 0 ? (
            <p className={styles.emptyNote}>No leads assigned to {name || username}.{data.crm.capturedLeads > 0 ? ` Captured ${data.crm.capturedLeads}.` : ''}</p>
          ) : (
            <div className={styles.totalsGrid}>
              <div className={styles.totalCard}>
                <div className={styles.totalValue}>{data.crm.totalLeads}</div>
                <div className={styles.totalLabel}>Assigned</div>
              </div>
              <div className={styles.totalCard}>
                <div className={styles.totalValue}>{data.crm.calledLeads}</div>
                <div className={styles.totalLabel}>Called</div>
              </div>
              <div className={styles.totalCard}>
                <div className={styles.totalValue}>{data.crm.qualifiedLeads}</div>
                <div className={styles.totalLabel}>Suitable</div>
              </div>
              <div className={styles.totalCard}>
                <div className={styles.totalValue}>{data.crm.lostLeads}</div>
                <div className={styles.totalLabel}>Not suitable</div>
              </div>
              <div className={styles.totalCard}>
                <div className={styles.totalValue}>{data.crm.awaitingCallLeads}</div>
                <div className={styles.totalLabel}>Awaiting a call</div>
              </div>
              <div className={styles.totalCard}>
                <div className={styles.totalValue}>{data.crm.callbacksDue}</div>
                <div className={styles.totalLabel}>Call-backs due</div>
              </div>
              <div className={styles.totalCard}>
                <div className={styles.totalValue}>{data.crm.unattendedLeads}</div>
                <div className={styles.totalLabel}>No call in {FOLLOW_UP_DAYS} days</div>
              </div>
              <div className={styles.totalCard}>
                <div className={styles.totalValue}>{data.crm.capturedLeads}</div>
                <div className={styles.totalLabel}>Captured by them</div>
              </div>
            </div>
          )}

          <h3 className={styles.sectionTitle}>Tasks{taskFilter ? ' — click a tile again to hide the list' : ' — click a tile to see the tasks'}</h3>
          {data.tasks.total === 0 ? (
            <p className={styles.emptyNote}>No tasks assigned in TMS.</p>
          ) : (
            <>
              <div className={styles.totalsGrid}>
                <button type="button" className={`${styles.totalCard} ${styles.totalCardClickable} ${taskFilter === 'total' ? styles.totalCardActive : ''}`} onClick={() => setTaskFilter((f) => (f === 'total' ? null : 'total'))}>
                  <div className={styles.totalValue}>{data.tasks.total}</div>
                  <div className={styles.totalLabel}>Total</div>
                </button>
                <button type="button" className={`${styles.totalCard} ${styles.totalCardClickable} ${taskFilter === 'completed' ? styles.totalCardActive : ''}`} onClick={() => setTaskFilter((f) => (f === 'completed' ? null : 'completed'))}>
                  <div className={styles.totalValue}>{data.tasks.completed}</div>
                  <div className={styles.totalLabel}>Completed</div>
                </button>
                <button type="button" className={`${styles.totalCard} ${styles.totalCardClickable} ${taskFilter === 'pending' ? styles.totalCardActive : ''}`} onClick={() => setTaskFilter((f) => (f === 'pending' ? null : 'pending'))}>
                  <div className={styles.totalValue}>{data.tasks.pending}</div>
                  <div className={styles.totalLabel}>Pending</div>
                </button>
              </div>
              {taskFilter && (() => {
                const filtered = data.tasksList.filter((t) =>
                  taskFilter === 'total' ? true : taskFilter === 'completed' ? t.status === 'completed' : t.status !== 'completed' && t.status !== 'cancelled'
                );
                return filtered.length === 0 ? (
                  <p className={styles.emptyNote}>No tasks in this bucket.</p>
                ) : (
                  <ul className={styles.memberList}>
                    {filtered.map((t) => (
                      <li key={t.id}>
                        <Link href={`/tms/tasks/${t.id}`} className={styles.memberLink}>
                          <div className={styles.member}>
                            <div className={styles.memberBody}>
                              <div className={styles.memberTop}>
                                <span className={styles.memberName}>{t.label}</span>
                                <span className={styles.memberDesignation}>{TMS_TASK_STATUS_LABEL[t.status as keyof typeof TMS_TASK_STATUS_LABEL] || t.status}</span>
                              </div>
                              {(t.projectName || t.dueDate) && (
                                <div className={styles.memberDesignation}>{[t.projectName, t.dueDate].filter(Boolean).join(' · ')}</div>
                              )}
                            </div>
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                );
              })()}
            </>
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
