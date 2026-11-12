'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import AppShell from './AppShell';
import { SkeletonRows } from './ui/Skeleton';
import calcStyles from './calculator.module.css';
import historyStyles from './quotationHistory.module.css';
import styles from './feedback.module.css';

interface ModuleEntry {
  key: string;
  label: string;
  section: string;
  rating: number | null;
  comment: string;
}

interface Response {
  id: string;
  username: string;
  name: string;
  role: string;
  department: string;
  designation: string;
  overallRating: number | null;
  overallComment: string;
  moduleFeedback: ModuleEntry[];
  worksWell: string;
  slowsMeDown: string;
  missingFeatures: string;
  submittedAt: string;
}

interface Payload {
  open: boolean;
  lastDay: string;
  daysRemaining: number;
  total: number;
  eligible: number;
  pending: { username: string; name: string; department: string }[];
  responses: Response[];
}

const avg = (nums: number[]) => (nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : null);

export default function AdminFeedbackView() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [openRow, setOpenRow] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/feedback');
      if (!response.ok) {
        setError(response.status === 403 ? 'Feedback responses are visible to admins only.' : 'Could not load responses.');
        return;
      }
      setData(await response.json());
    } catch {
      setError('Could not reach the server.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const departments = useMemo(
    () => [...new Set((data?.responses ?? []).map((r) => r.department).filter(Boolean))].sort(),
    [data]
  );

  const shown = useMemo(
    () => (data?.responses ?? []).filter((r) => !deptFilter || r.department === deptFilter),
    [data, deptFilter]
  );

  const overallAvg = useMemo(
    () => avg(shown.map((r) => r.overallRating).filter((n): n is number => n !== null)),
    [shown]
  );

  // Which features scored worst, across everyone shown. This is the view
  // that answers "where should we spend the next sprint" — a list of
  // individual responses does not.
  const byModule = useMemo(() => {
    const map = new Map<string, { label: string; section: string; ratings: number[]; comments: { who: string; text: string }[] }>();
    shown.forEach((r) => {
      r.moduleFeedback.forEach((m) => {
        const entry = map.get(m.key) ?? { label: m.label, section: m.section, ratings: [], comments: [] };
        if (m.rating !== null) entry.ratings.push(m.rating);
        if (m.comment) entry.comments.push({ who: `${r.name}${r.department ? ` · ${r.department}` : ''}`, text: m.comment });
        map.set(m.key, entry);
      });
    });
    return [...map.entries()]
      .map(([key, v]) => ({ key, ...v, average: avg(v.ratings), responses: v.ratings.length }))
      // Worst first, and only where enough people answered to mean anything.
      .sort((a, b) => (a.average ?? 99) - (b.average ?? 99));
  }, [shown]);

  if (error) {
    return (
      <AppShell title="Staff Feedback" subtitle="Administration › what the team said about MatrixIQ">
        <div className={historyStyles.status}>{error}</div>
      </AppShell>
    );
  }
  if (!data) {
    return (
      <AppShell title="Staff Feedback" subtitle="Administration › what the team said about MatrixIQ">
        <SkeletonRows rows={6} columns={3} />
      </AppShell>
    );
  }

  return (
    <AppShell title="Staff Feedback" subtitle="Administration › what the team said about MatrixIQ">
      <div className={calcStyles.sectionPanel}>
        <div className={styles.windowNote}>
          {data.open
            ? `Collecting until ${data.lastDay} · ${data.daysRemaining} day${data.daysRemaining === 1 ? '' : 's'} left`
            : `Closed on ${data.lastDay}`}
        </div>
        <div className={historyStyles.summaryCardGrid}>
          <Stat label="Responses" value={String(data.total)} />
          <Stat label="Of eligible staff" value={`${data.total} / ${data.eligible}`} />
          <Stat label="Response rate" value={data.eligible ? `${Math.round((data.total / data.eligible) * 100)}%` : '—'} />
          <Stat label="Average overall" value={overallAvg === null ? '—' : `${overallAvg} / 5`} />
        </div>
      </div>

      {departments.length > 1 && (
        <div className={calcStyles.sectionPanel}>
          <label className={calcStyles.label} htmlFor="deptFilter">Department</label>
          <select id="deptFilter" className={calcStyles.formControl} value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
      )}

      {/* Lowest-scoring features first ------------------------------------ */}
      {byModule.length > 0 && (
        <div className={calcStyles.sectionPanel}>
          <h2 className={calcStyles.h2}>By feature — lowest rated first</h2>
          <div className={historyStyles.tableWrap}>
            <table className={historyStyles.table}>
              <thead>
                <tr><th>Feature</th><th>Section</th><th>Average</th><th>Ratings</th><th>Comments</th></tr>
              </thead>
              <tbody>
                {byModule.map((m) => (
                  <tr key={m.key}>
                    <td>{m.label}</td>
                    <td>{m.section}</td>
                    <td>{m.average === null ? '—' : `${m.average} / 5`}</td>
                    <td>{m.responses}</td>
                    <td>
                      {m.comments.length === 0 ? '—' : (
                        <details>
                          <summary>{m.comments.length} comment{m.comments.length === 1 ? '' : 's'}</summary>
                          {m.comments.map((c, i) => (
                            <div key={i} className={styles.lead}><strong>{c.who}:</strong> {c.text}</div>
                          ))}
                        </details>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Individual responses --------------------------------------------- */}
      <div className={calcStyles.sectionPanel}>
        <h2 className={calcStyles.h2}>Responses ({shown.length})</h2>
        {shown.length === 0 ? (
          <div className={historyStyles.status}>No responses yet.</div>
        ) : (
          <div className={historyStyles.tableWrap}>
            <table className={historyStyles.table}>
              <thead>
                <tr><th>Person</th><th>Department</th><th>Role</th><th>Overall</th><th>Submitted</th><th /></tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <>
                    <tr key={r.id}>
                      <td>{r.name}<br /><span className={styles.moduleDesc}>{r.designation || r.username}</span></td>
                      <td>{r.department || '—'}</td>
                      <td>{r.role}</td>
                      <td>{r.overallRating === null ? '—' : `${r.overallRating} / 5`}</td>
                      <td>{new Date(r.submittedAt).toLocaleDateString('en-IN')}</td>
                      <td>
                        <button type="button" className={historyStyles.linkBtn} onClick={() => setOpenRow(openRow === r.id ? null : r.id)}>
                          {openRow === r.id ? 'Hide' : 'Read'}
                        </button>
                      </td>
                    </tr>
                    {openRow === r.id && (
                      <tr key={`${r.id}-detail`}>
                        <td colSpan={6}>
                          <Detail label="Overall" text={r.overallComment} />
                          <Detail label="What works well" text={r.worksWell} />
                          <Detail label="What slows them down" text={r.slowsMeDown} />
                          <Detail label="What's missing" text={r.missingFeatures} />
                          {r.moduleFeedback.filter((m) => m.rating !== null || m.comment).map((m) => (
                            <div key={m.key} className={styles.lead}>
                              <strong>{m.label}</strong>
                              {m.rating !== null ? ` — ${m.rating}/5` : ''}
                              {m.comment ? `: ${m.comment}` : ''}
                            </div>
                          ))}
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Who has not answered, so a nudge goes to the right people --------- */}
      {data.open && data.pending.length > 0 && (
        <div className={calcStyles.sectionPanel}>
          <h2 className={calcStyles.h2}>Not yet responded ({data.pending.length})</h2>
          <p className={styles.lead}>
            {data.pending.map((p) => `${p.name}${p.department ? ` (${p.department})` : ''}`).join(' · ')}
          </p>
        </div>
      )}
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={historyStyles.summaryCard}>
      <div className={historyStyles.summaryCardLabel}>{label}</div>
      <div className={historyStyles.summaryCardValue}>{value}</div>
    </div>
  );
}

function Detail({ label, text }: { label: string; text: string }) {
  if (!text) return null;
  return (
    <div className={styles.lead}>
      <strong>{label}:</strong> {text}
    </div>
  );
}
