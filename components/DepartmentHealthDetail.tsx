'use client';

import { useEffect, useState } from 'react';
import { Info, X } from 'lucide-react';
import { useModalBehavior } from '@/lib/useModalBehavior';
import { BAND_COLOR, BAND_TEXT, type HealthBand } from './ui/HealthGauge';
import ErrorState from './ui/ErrorState';
import { SkeletonRows } from './ui/Skeleton';
import notifyStyles from './ui/notify.module.css';
import styles from './departmentHealthDetail.module.css';

interface MetricRow { label: string; value: string; }

interface MemberDetail {
  id: string;
  username: string;
  name: string;
  designation: string;
  score: number | null;
  metrics: MetricRow[];
}

interface DepartmentHealthResponse {
  department: string;
  description: string;
  score: number;
  band: HealthBand;
  breakdown: MetricRow[];
  formula: string;
  thresholds: { green: number; yellow: number };
  teamSize: number;
  scoredCount: number;
  managers: { id: string; username: string; name: string }[];
  selfOnly: boolean;
  members: MemberDetail[];
}

function bandOf(score: number, thresholds: { green: number; yellow: number }): Exclude<HealthBand, 'na'> {
  if (score >= thresholds.green) return 'green';
  if (score >= thresholds.yellow) return 'yellow';
  return 'red';
}

function initialsOf(name: string, fallback: string): string {
  const source = (name || fallback || '').trim();
  if (!source) return '?';
  return source.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

export default function DepartmentHealthDetail({ department, onClose }: { department: string; onClose: () => void }) {
  const cardRef = useModalBehavior(onClose);
  const [data, setData] = useState<DepartmentHealthResponse | null>(null);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/dashboard/health/${encodeURIComponent(department)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 403 ? 'You do not have access to this department.' : `Server responded with ${r.status}`);
        return r.json();
      })
      .then((json: DepartmentHealthResponse) => {
        if (!cancelled) setData(json);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message || 'Could not load this department.');
      });
    return () => {
      cancelled = true;
    };
  }, [department, reloadKey]);

  const color = data ? BAND_COLOR[data.band] : BAND_COLOR.na;

  return (
    <div className={notifyStyles.overlay} role="presentation" onClick={onClose}>
      <div
        ref={cardRef}
        className={`${notifyStyles.wideCard} ${styles.card}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="deptHealthTitle"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.head}>
          <div className={styles.headText}>
            <div className={styles.eyebrow}>Department health</div>
            <h2 className={styles.title} id="deptHealthTitle">{department}</h2>
            {data?.description && <p className={styles.description}>{data.description}</p>}
          </div>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {error ? (
          <ErrorState message={error} onRetry={() => { setError(''); setReloadKey((k) => k + 1); }} />
        ) : !data ? (
          <div className={styles.loadingWrap}><SkeletonRows rows={5} columns={3} /></div>
        ) : (
          <>
            {/* Score against the scale — the number plus where it actually sits
                between the two band thresholds, which a bare percentage can't
                convey on its own. */}
            <div className={styles.scoreBlock}>
              <div className={styles.scoreValue} style={{ color }}>
                {data.band === 'na' ? '—' : `${data.score}%`}
              </div>
              <div className={styles.scoreMeta}>
                <div className={styles.scoreBand} style={{ color }}>{BAND_TEXT[data.band]}</div>
                <div className={styles.scoreSub}>
                  {data.band === 'na'
                    ? `No scoreable activity yet across ${data.teamSize} team member${data.teamSize === 1 ? '' : 's'}.`
                    : `Average of ${data.scoredCount} scored member${data.scoredCount === 1 ? '' : 's'} of ${data.teamSize} in the team.`}
                </div>
              </div>
            </div>

            {data.band !== 'na' && (
              <div className={styles.scale} aria-hidden="true">
                <div className={styles.scaleTrack}>
                  <span className={styles.zoneRed} style={{ width: `${data.thresholds.yellow}%` }} />
                  <span className={styles.zoneYellow} style={{ width: `${data.thresholds.green - data.thresholds.yellow}%` }} />
                  <span className={styles.zoneGreen} style={{ width: `${100 - data.thresholds.green}%` }} />
                  <span className={styles.scaleMarker} style={{ left: `${Math.max(0, Math.min(100, data.score))}%`, borderColor: color }} />
                </div>
                <div className={styles.scaleLabels}>
                  <span>0</span>
                  <span style={{ left: `${data.thresholds.yellow}%` }} className={styles.scaleTick}>{data.thresholds.yellow}</span>
                  <span style={{ left: `${data.thresholds.green}%` }} className={styles.scaleTick}>{data.thresholds.green}</span>
                  <span>100</span>
                </div>
              </div>
            )}

            <div className={styles.formula}>
              <Info size={14} className={styles.formulaIcon} />
              <span>{data.formula}</span>
            </div>

            {data.breakdown.length > 0 && (
              <>
                <h3 className={styles.sectionTitle}>Department totals</h3>
                <div className={styles.totalsGrid}>
                  {data.breakdown.map((row) => (
                    <div key={row.label} className={styles.totalCard}>
                      <div className={styles.totalValue}>{row.value}</div>
                      <div className={styles.totalLabel}>{row.label}</div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {data.managers.length > 0 && (
              <>
                <h3 className={styles.sectionTitle}>Managed by</h3>
                <div className={styles.managerRow}>
                  {data.managers.map((m) => (
                    <span key={m.id} className={styles.managerChip}>
                      <span className={styles.managerAvatar}>{initialsOf(m.name, m.username)}</span>
                      {m.name || m.username}
                    </span>
                  ))}
                </div>
              </>
            )}

            <h3 className={styles.sectionTitle}>
              {data.selfOnly ? 'Your contribution' : `Team breakdown (${data.members.length})`}
            </h3>
            {data.members.length === 0 ? (
              <p className={styles.emptyNote}>This department has no active members.</p>
            ) : (
              <ul className={styles.memberList}>
                {data.members.map((m) => {
                  const scored = m.score !== null;
                  const memberColor = scored ? BAND_COLOR[bandOf(m.score as number, data.thresholds)] : BAND_COLOR.na;
                  return (
                    <li key={m.id} className={styles.member}>
                      <span className={styles.memberAvatar} style={scored ? { background: memberColor } : undefined}>
                        {initialsOf(m.name, m.username)}
                      </span>
                      <div className={styles.memberBody}>
                        <div className={styles.memberTop}>
                          <span className={styles.memberName}>
                            {m.name || m.username}
                            {m.designation && <span className={styles.memberDesignation}> · {m.designation}</span>}
                          </span>
                          <span className={styles.memberScore} style={{ color: memberColor }}>
                            {scored ? `${m.score}%` : 'No data'}
                          </span>
                        </div>
                        <div className={styles.memberBar}>
                          <span
                            className={styles.memberBarFill}
                            style={{ width: scored ? `${Math.max(0, Math.min(100, m.score as number))}%` : '0%', background: memberColor }}
                          />
                        </div>
                        {m.metrics.length > 0 ? (
                          <div className={styles.memberMetrics}>
                            {m.metrics.map((metric) => (
                              <span key={metric.label} className={styles.memberMetric}>
                                {metric.label}: <strong>{metric.value}</strong>
                              </span>
                            ))}
                          </div>
                        ) : (
                          <div className={styles.memberMetrics}>
                            <span className={styles.memberMetric}>No metric is defined for this department.</span>
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* An explicit note, because "No data" next to a name reads as a
                zero otherwise — these members are excluded from the average,
                not scored badly. */}
            {data.members.some((m) => m.score === null) && (
              <p className={styles.emptyNote}>
                Members showing “No data” have no scoreable activity yet and are excluded from the department average — they are not counted as zero.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
