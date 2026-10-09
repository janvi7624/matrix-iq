'use client';

import { useEffect, useState } from 'react';
import { Cake, Award, PartyPopper } from 'lucide-react';
import { SkeletonRows } from './ui/Skeleton';
import historyStyles from './quotationHistory.module.css';
import styles from './celebrations.module.css';

interface CelebrationEntry {
  name: string;
  employeeId: string;
  department: string;
  designation: string;
  date: string;
  daysAway: number;
  isToday: boolean;
  years?: number;
}

function formatDateShort(val: string): string {
  if (!val) return '—';
  const d = new Date(val + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function DaysLabel({ days }: { days: number }) {
  if (days === 0) {
    return <span className={`${styles.daysLabel} ${styles.daysLabelToday}`}>Today</span>;
  }
  if (days === 1) {
    return <span className={`${styles.daysLabel} ${styles.daysLabelTomorrow}`}>Tomorrow</span>;
  }
  return <span className={`${styles.daysLabel} ${styles.daysLabelFuture}`}>in {days} days</span>;
}

function CelebrationEmptyState({ icon: Icon, message }: { icon: typeof Cake; message: string }) {
  return (
    <div className={styles.celebrationEmpty}>
      <Icon size={32} strokeWidth={1.5} className={styles.celebrationEmptyIcon} />
      <p className={styles.celebrationEmptyText}>{message}</p>
    </div>
  );
}

const TONE_CLASS = { brand: styles.toneBrand, info: styles.toneInfo } as const;

// First letters of the first two words — "Asha Rani" -> "AR". Falls back to
// one letter for a single-word name, and to nothing for a blank one rather
// than rendering an empty circle with a stray character in it.
function initialsOf(name: string): string {
  return (name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function CelebrationCard({ entry, type }: { entry: CelebrationEntry; type: 'birthday' | 'anniversary' }) {
  const isBirthday = type === 'birthday';
  const toneClass = TONE_CLASS[isBirthday ? 'brand' : 'info'];

  return (
    <div className={`${styles.celebrationCard} ${toneClass} ${entry.isToday ? styles.celebrationCardToday : ''}`}>
      {/* An initials avatar rather than a repeated cake/award glyph: every
          row in a birthdays list is a birthday, so the icon carried no
          information — the person is what distinguishes the rows. */}
      <span className={styles.avatar} aria-hidden="true">{initialsOf(entry.name)}</span>

      <div className={styles.celebrationBody}>
        <div className={styles.celebrationNameRow}>
          <span className={styles.celebrationName}>{entry.name}</span>
          {entry.isToday && <PartyPopper size={13} color="var(--tone-color)" />}
        </div>
        <div className={styles.celebrationMeta}>
          {entry.department || '—'}
          {entry.years ? ` · ${entry.years} yr${entry.years === 1 ? '' : 's'}` : ''}
        </div>
      </div>

      <div className={styles.celebrationDateWrap}>
        <span className={styles.celebrationDate}>{formatDateShort(entry.date)}</span>
        <DaysLabel days={entry.daysAway} />
      </div>
    </div>
  );
}

// How many rows each panel shows before collapsing the rest. The section
// used to render every entry in a 30-day window, which is what made it the
// tallest thing on the dashboard.
const CELEBRATION_PREVIEW = 4;

function CelebrationPanel({
  entries,
  type,
  title,
  icon: Icon,
  toneClass,
  emptyMessage
}: {
  entries: CelebrationEntry[];
  type: 'birthday' | 'anniversary';
  title: string;
  icon: typeof Cake;
  toneClass: string;
  emptyMessage: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const todayCount = entries.filter((e) => e.isToday).length;
  const shown = expanded ? entries : entries.slice(0, CELEBRATION_PREVIEW);
  const hidden = entries.length - shown.length;

  return (
    <div className={styles.panel}>
      <div className={`${styles.panelHeader} ${toneClass}`}>
        <Icon size={16} color="var(--tone-color)" strokeWidth={2.2} />
        <h2 className={styles.panelTitle}>{title}</h2>
        {/* The summary figure lives in the header rather than in its own
            stat card above — four cards restating these counts cost a whole
            row of the page to say what these two badges say. */}
        {todayCount > 0 && <span className={styles.panelToday}>{todayCount} today</span>}
        <span className={styles.panelCount}>{entries.length}</span>
      </div>

      {entries.length === 0 ? (
        <CelebrationEmptyState icon={Icon} message={emptyMessage} />
      ) : (
        <>
          {shown.map((entry, i) => <CelebrationCard key={`${type}-${i}`} entry={entry} type={type} />)}
          {(hidden > 0 || expanded) && (
            <button type="button" className={styles.panelMore} onClick={() => setExpanded((v) => !v)}>
              {expanded ? 'Show less' : `Show ${hidden} more`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

// The upcoming birthdays / work anniversaries block, previously its own
// "HR Dashboard" page (/hr-dashboard, removed). It lives on the main
// dashboard now: /api/hr-dashboard is readable by any signed-in viewer, so
// there's nothing HR-specific left to gate. A failed fetch renders nothing
// rather than toasting — this is one section of a shared dashboard, not the
// whole page, so it must never block the rest of it.
export default function CelebrationsSection() {
  const [birthdays, setBirthdays] = useState<CelebrationEntry[]>([]);
  const [anniversaries, setAnniversaries] = useState<CelebrationEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let active = true;
    fetch('/api/hr-dashboard')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        if (!active) return;
        setBirthdays(data.birthdays || []);
        setAnniversaries(data.anniversaries || []);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setLoadFailed(true);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  if (loadFailed) return null;

  if (loading) {
    return (
      <div className={historyStyles.tableWrap}>
        <SkeletonRows rows={4} columns={4} />
      </div>
    );
  }

  // Nothing to celebrate in the next 30 days — render nothing at all
  // rather than two empty panels and a row of zeroes taking up the foot of
  // the dashboard.
  if (!birthdays.length && !anniversaries.length) return null;

  return (
    <div className={styles.panelGrid}>
      <CelebrationPanel
        entries={birthdays}
        type="birthday"
        title="Upcoming Birthdays"
        icon={Cake}
        toneClass={styles.toneBrand}
        emptyMessage="No birthdays in the next 30 days"
      />
      <CelebrationPanel
        entries={anniversaries}
        type="anniversary"
        title="Work Anniversaries"
        icon={Award}
        toneClass={styles.toneInfo}
        emptyMessage="No work anniversaries in the next 30 days"
      />
    </div>
  );
}
