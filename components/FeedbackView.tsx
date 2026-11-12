'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import AppShell from './AppShell';
import { SkeletonRows } from './ui/Skeleton';
import calcStyles from './calculator.module.css';
import historyStyles from './quotationHistory.module.css';
import styles from './feedback.module.css';

interface ModuleQuestion {
  key: string;
  label: string;
  section: string;
  desc: string;
}

interface ModuleAnswer {
  rating: number | null;
  comment: string;
}

interface ExistingResponse {
  overallRating: number | null;
  overallComment: string;
  moduleFeedback: { key: string; rating: number | null; comment: string }[];
  worksWell: string;
  slowsMeDown: string;
  missingFeatures: string;
  submittedAt: string;
}

interface FeedbackPayload {
  open: boolean;
  lastDay: string;
  daysRemaining: number;
  viewer: { name: string; role: string; department: string; designation: string };
  modules: ModuleQuestion[];
  existing: ExistingResponse | null;
}

const RATINGS = [
  { value: 1, label: 'Poor' },
  { value: 2, label: 'Weak' },
  { value: 3, label: 'OK' },
  { value: 4, label: 'Good' },
  { value: 5, label: 'Excellent' }
];

export default function FeedbackView() {
  const [data, setData] = useState<FeedbackPayload | null>(null);
  const [loadError, setLoadError] = useState('');
  const [answers, setAnswers] = useState<Record<string, ModuleAnswer>>({});
  const [overallRating, setOverallRating] = useState<number | null>(null);
  const [overallComment, setOverallComment] = useState('');
  const [worksWell, setWorksWell] = useState('');
  const [slowsMeDown, setSlowsMeDown] = useState('');
  const [missingFeatures, setMissingFeatures] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/feedback');
      if (!response.ok) throw new Error(String(response.status));
      const payload: FeedbackPayload = await response.json();
      setData(payload);
      // Pre-fill from a previous answer so revisiting is editing, not
      // starting again — people abandon a form that discards their work.
      if (payload.existing) {
        setOverallRating(payload.existing.overallRating);
        setOverallComment(payload.existing.overallComment);
        setWorksWell(payload.existing.worksWell);
        setSlowsMeDown(payload.existing.slowsMeDown);
        setMissingFeatures(payload.existing.missingFeatures);
        const seeded: Record<string, ModuleAnswer> = {};
        payload.existing.moduleFeedback.forEach((m) => {
          seeded[m.key] = { rating: m.rating, comment: m.comment };
        });
        setAnswers(seeded);
      }
    } catch {
      setLoadError('Could not load the feedback form.');
    }
  }, []);

  useEffect(() => {
    // load() is async and every setState in it happens after an await, so
    // this is not the cascading-render case the rule guards against — it
    // cannot distinguish "calls a function that eventually sets state"
    // from "sets state synchronously". Same fetch-on-mount shape used
    // across this codebase.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // Grouped by the same sections the sidebar uses, so the form reads in the
  // order people already navigate the app.
  const grouped = useMemo(() => {
    const map = new Map<string, ModuleQuestion[]>();
    (data?.modules ?? []).forEach((m) => {
      const bucket = map.get(m.section);
      if (bucket) bucket.push(m);
      else map.set(m.section, [m]);
    });
    return [...map.entries()];
  }, [data]);

  const answered = useMemo(
    () => Object.values(answers).filter((a) => a.rating !== null || a.comment.trim()).length,
    [answers]
  );

  function setAnswer(key: string, patch: Partial<ModuleAnswer>) {
    setAnswers((prev) => {
      const current = prev[key] ?? { rating: null, comment: '' };
      return { ...prev, [key]: { ...current, ...patch } };
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!data?.open) return;
    setSaving(true);
    setStatus('');
    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          overallRating,
          overallComment,
          worksWell,
          slowsMeDown,
          missingFeatures,
          moduleFeedback: (data?.modules ?? []).map((m) => ({
            key: m.key,
            label: m.label,
            section: m.section,
            rating: answers[m.key]?.rating ?? null,
            comment: answers[m.key]?.comment ?? ''
          }))
        })
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setStatus(body?.error || 'Could not save your feedback. Please try again.');
        return;
      }
      setStatus('Thank you — your feedback has been recorded. You can come back and change it any time before the form closes.');
      await load();
    } catch {
      setStatus('Could not reach the server. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <AppShell title="Your Feedback" subtitle="Tell us how MatrixIQ is working for you">
        <div className={historyStyles.status}>{loadError}</div>
      </AppShell>
    );
  }

  if (!data) {
    return (
      <AppShell title="Your Feedback" subtitle="Tell us how MatrixIQ is working for you">
        <SkeletonRows rows={6} columns={2} />
      </AppShell>
    );
  }

  // The window has passed. The page still resolves rather than 404ing so a
  // bookmark or a link in the announcement email lands somewhere that
  // explains itself.
  if (!data.open) {
    return (
      <AppShell title="Your Feedback" subtitle="Tell us how MatrixIQ is working for you">
        <div className={calcStyles.sectionPanel}>
          <h2 className={calcStyles.h2}>Feedback is closed</h2>
          <p className={styles.lead}>
            This was a short collection that ran until {data.lastDay}. Thank you to everyone who took the time —
            the responses have gone to the admin team.
          </p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Your Feedback" subtitle="Tell us how MatrixIQ is working for you">
      <form onSubmit={submit}>
        <div className={calcStyles.sectionPanel}>
          <div className={styles.windowNote}>
            Open until <strong>{data.lastDay}</strong>
            {data.daysRemaining > 0 ? ` · ${data.daysRemaining} day${data.daysRemaining === 1 ? '' : 's'} left` : ''}
          </div>
          <p className={styles.lead}>
            Hello {data.viewer.name} — you&rsquo;re seeing the parts of MatrixIQ that belong to your work
            {data.viewer.department ? ` in ${data.viewer.department}` : ''}. Answer only what&rsquo;s useful to you;
            every field is optional, and you can come back and change your answers until the form closes.
          </p>
          <p className={styles.privacy}>
            Your responses go to the admin team only, and your name is attached so they can follow up with you if
            something needs clarifying.
          </p>
        </div>

        {/* Overall ------------------------------------------------------- */}
        <div className={calcStyles.sectionPanel}>
          <h2 className={calcStyles.h2}>Overall, how is MatrixIQ working for you?</h2>
          <RatingRow value={overallRating} onChange={setOverallRating} name="overall" />
          <div className={calcStyles.field}>
            <label className={calcStyles.label} htmlFor="overallComment">Anything you&rsquo;d like to add</label>
            <textarea
              id="overallComment"
              className={calcStyles.formControl}
              rows={3}
              value={overallComment}
              onChange={(e) => setOverallComment(e.target.value)}
              placeholder="How it fits your day-to-day…"
            />
          </div>
        </div>

        {/* Per-feature, scoped to this person ---------------------------- */}
        <div className={calcStyles.sectionPanel}>
          <h2 className={calcStyles.h2}>The parts you use</h2>
          <p className={styles.lead}>
            These are the {data.modules.length} areas available to your role
            {data.viewer.department ? ` and department` : ''}. Rate the ones you actually use — skip the rest.
            {answered > 0 ? ` (${answered} answered so far)` : ''}
          </p>
          {grouped.map(([section, mods]) => (
            <div key={section} className={styles.sectionBlock}>
              <div className={styles.sectionTitle}>{section}</div>
              {mods.map((m) => (
                <div key={m.key} className={styles.moduleRow}>
                  <div className={styles.moduleHead}>
                    <span className={styles.moduleLabel}>{m.label}</span>
                    {m.desc ? <span className={styles.moduleDesc}>{m.desc}</span> : null}
                  </div>
                  <RatingRow
                    value={answers[m.key]?.rating ?? null}
                    onChange={(v) => setAnswer(m.key, { rating: v })}
                    name={`rating-${m.key}`}
                    compact
                  />
                  <input
                    className={calcStyles.formControl}
                    value={answers[m.key]?.comment ?? ''}
                    onChange={(e) => setAnswer(m.key, { comment: e.target.value })}
                    placeholder="Optional — what works, what doesn't"
                    aria-label={`Comment on ${m.label}`}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Open questions ------------------------------------------------ */}
        <div className={calcStyles.sectionPanel}>
          <h2 className={calcStyles.h2}>In your own words</h2>
          <div className={calcStyles.field}>
            <label className={calcStyles.label} htmlFor="worksWell">What works well?</label>
            <textarea id="worksWell" className={calcStyles.formControl} rows={3} value={worksWell} onChange={(e) => setWorksWell(e.target.value)} />
          </div>
          <div className={calcStyles.field}>
            <label className={calcStyles.label} htmlFor="slowsMeDown">What slows you down, or takes more steps than it should?</label>
            <textarea id="slowsMeDown" className={calcStyles.formControl} rows={3} value={slowsMeDown} onChange={(e) => setSlowsMeDown(e.target.value)} />
          </div>
          <div className={calcStyles.field}>
            <label className={calcStyles.label} htmlFor="missingFeatures">What&rsquo;s missing that would help your work?</label>
            <textarea id="missingFeatures" className={calcStyles.formControl} rows={3} value={missingFeatures} onChange={(e) => setMissingFeatures(e.target.value)} />
          </div>
        </div>

        <div className={calcStyles.sectionPanel}>
          <button type="submit" className={calcStyles.btn} disabled={saving}>
            {saving ? 'Saving…' : data.existing ? 'Update my feedback' : 'Submit my feedback'}
          </button>
          {data.existing ? (
            <span className={styles.savedNote}>
              Last saved {new Date(data.existing.submittedAt).toLocaleString('en-IN')}
            </span>
          ) : null}
          {status ? <div className={historyStyles.status}>{status}</div> : null}
        </div>
      </form>
    </AppShell>
  );
}

/** 1-5 with a clear "no answer" state — unrated must not look like 1. */
function RatingRow({
  value,
  onChange,
  name,
  compact = false
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  name: string;
  compact?: boolean;
}) {
  return (
    <div className={compact ? styles.ratingRowCompact : styles.ratingRow} role="radiogroup" aria-label="Rating">
      {RATINGS.map((r) => (
        <button
          key={r.value}
          type="button"
          role="radio"
          aria-checked={value === r.value}
          className={`${styles.ratingBtn} ${value === r.value ? styles.ratingBtnActive : ''}`}
          // Clicking the selected value again clears it, so a misclick is
          // recoverable without a separate "clear" control.
          onClick={() => onChange(value === r.value ? null : r.value)}
          name={name}
        >
          <span className={styles.ratingValue}>{r.value}</span>
          <span className={styles.ratingLabel}>{r.label}</span>
        </button>
      ))}
    </div>
  );
}
