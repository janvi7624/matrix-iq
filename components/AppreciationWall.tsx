'use client';

import { useEffect, useState } from 'react';
import styles from './hrAppreciation.module.css';

interface Item {
  id: string;
  employee_name: string;
  employee_department: string;
  nominated_by_name: string;
  task_completion_date: string;
  description: string;
  decided_at: string | null;
  reward_type?: string;
  reward_amount?: number | null;
}

const fmtDate = (d: string) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '');

const REWARD_LABEL: Record<string, string> = { certificate: 'Certificate', gift_voucher: 'Gift voucher', cash: 'Cash' };

// Approved Employee Appreciations. 'company' = the dashboard wall (recent,
// everyone); 'mine' = the viewer's own on their profile (with reward).
// Renders nothing at all while there is nothing to show, so it never adds an
// empty box to the dashboard.
export default function AppreciationWall({ mode }: { mode: 'company' | 'mine' }) {
  const [items, setItems] = useState<Item[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(mode === 'mine' ? '/api/appreciations?mine=1' : '/api/appreciations')
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (!cancelled) setItems(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [mode]);

  if (!items || items.length === 0) return null;

  return (
    <section className={styles.wall} aria-label={mode === 'mine' ? 'My appreciations' : 'Employee appreciations'}>
      <div className={styles.wallTitle}>{mode === 'mine' ? '🏆 My Appreciations' : '🏆 Employee Appreciations'}</div>
      <div className={styles.wallGrid}>
        {items.map((a) => (
          <article key={a.id} className={styles.wallCard}>
            {a.task_completion_date && <div className={styles.wallCategory}>Completed {fmtDate(a.task_completion_date)}</div>}
            {mode === 'company' && (
              <div className={styles.name}>
                {a.employee_name}
                {a.employee_department ? <span className={styles.meta}> · {a.employee_department}</span> : null}
              </div>
            )}
            <p className={styles.wallDesc}>{a.description}</p>
            <div className={styles.meta}>
              Appreciated by {a.nominated_by_name}
              {a.decided_at ? ` · ${new Date(a.decided_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}` : ''}
              {mode === 'mine' && a.reward_type && a.reward_type !== 'none'
                ? ` · Reward: ${REWARD_LABEL[a.reward_type] || a.reward_type}${a.reward_amount ? ` ₹${a.reward_amount.toLocaleString('en-IN')}` : ''}`
                : ''}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
