'use client';

import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import AppShell from './AppShell';
import CommonButton from './ui/CommonButton';
import StatCard, { StatCardGrid } from './ui/StatCard';
import { SkeletonStatCards, SkeletonTable } from './ui/Skeleton';
import calcStyles from './calculator.module.css';
import historyStyles from './quotationHistory.module.css';
import styles from './feedback.module.css';
import Dropdown, { inSelection } from '@/components/ui/Dropdown';

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

// Embedded (My Products) renders inside the host page's own shell.
function Shell({ embedded, children }: { embedded: boolean; children: ReactNode }) {
  return embedded ? <>{children}</> : <AppShell title="Staff Feedback" subtitle="Administration › what the team said about MatrixIQ">{children}</AppShell>;
}

export default function AdminFeedbackView({ endpoint = '/api/admin/feedback', embedded = false }: { endpoint?: string; embedded?: boolean } = {}) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState('');
  const [deptFilter, setDeptFilter] = useState<string[]>([]);
  const [openRow, setOpenRow] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(endpoint);
      if (!response.ok) {
        setError(response.status === 403 ? 'Feedback responses are visible to admins only.' : 'Could not load responses.');
        return;
      }
      setData(await response.json());
    } catch {
      setError('Could not reach the server.');
    }
  }, [endpoint]);

  useEffect(() => {
    // load() is async and every setState in it happens after an await, so
    // this is not the cascading-render case the rule guards against — it
    // cannot distinguish "calls a function that eventually sets state"
    // from "sets state synchronously". Same fetch-on-mount shape used
    // across this codebase.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const departments = useMemo(
    () => [...new Set((data?.responses ?? []).map((r) => r.department).filter(Boolean))].sort(),
    [data]
  );

  const shown = useMemo(
    () => (data?.responses ?? []).filter((r) => inSelection(r.department, deptFilter)),
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
      <Shell embedded={embedded}>
        <div className={historyStyles.status}>{error}</div>
      </Shell>
    );
  }
  if (!data) {
    return (
      <Shell embedded={embedded}>
        <div className={calcStyles.sectionPanel}>
          <SkeletonStatCards count={4} withIcon={false} />
        </div>
        <div className={calcStyles.sectionPanel}>
          <SkeletonTable columns={5} rows={6} />
        </div>
      </Shell>
    );
  }

  return (
    <Shell embedded={embedded}>
      <div className={calcStyles.sectionPanel}>
        <div className={styles.windowNote}>
          {data.open
            ? `Collecting until ${data.lastDay} · ${data.daysRemaining} day${data.daysRemaining === 1 ? '' : 's'} left`
            : `Closed on ${data.lastDay}`}
        </div>
        <StatCardGrid>
          <Stat label="Responses" value={String(data.total)} />
          <Stat label="Of eligible staff" value={`${data.total} / ${data.eligible}`} />
          <Stat label="Response rate" value={data.eligible ? `${Math.round((data.total / data.eligible) * 100)}%` : '—'} />
          <Stat label="Average overall" value={overallAvg === null ? '—' : `${overallAvg} / 5`} />
        </StatCardGrid>
      </div>

      {departments.length > 1 && (
        <div className={calcStyles.sectionPanel}>
          <label className={calcStyles.label} htmlFor="deptFilter">Department</label>
          <Dropdown
            id="deptFilter"
            multiselect
            value={deptFilter}
            onChange={setDeptFilter}
            options={departments.map((d) => ({ value: d, label: d }))}
            placeholder="All departments"
          />
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
                        <CommonButton variant="link" size="sm" onClick={() => setOpenRow(openRow === r.id ? null : r.id)}>
                          {openRow === r.id ? 'Hide' : 'Read'}
                        </CommonButton>
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
    </Shell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <StatCard label={label} value={value} />;
}

function Detail({ label, text }: { label: string; text: string }) {
  if (!text) return null;
  return (
    <div className={styles.lead}>
      <strong>{label}:</strong> {text}
    </div>
  );
}
