'use client';

import { useEffect, useState } from 'react';
import { Cake, Award, PartyPopper, CalendarDays } from 'lucide-react';
import AppShell from './AppShell';
import { useToast } from './ui/ToastProvider';
import { SkeletonRows } from './ui/Skeleton';
import historyStyles from './quotationHistory.module.css';
import styles from './hrDashboard.module.css';

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

function CelebrationCard({ entry, type }: { entry: CelebrationEntry; type: 'birthday' | 'anniversary' }) {
  const isBirthday = type === 'birthday';
  const tone = isBirthday ? 'brand' : 'info';
  const toneClass = TONE_CLASS[tone];

  return (
    <div className={`${styles.celebrationCard} ${toneClass} ${entry.isToday ? styles.celebrationCardToday : ''}`}>
      <div className={styles.celebrationIcon}>
        {isBirthday ? <Cake size={20} color="var(--tone-color)" strokeWidth={2} /> : <Award size={20} color="var(--tone-color)" strokeWidth={2} />}
      </div>

      <div className={styles.celebrationBody}>
        <div className={styles.celebrationNameRow}>
          <span className={styles.celebrationName}>{entry.name}</span>
          {entry.isToday && <PartyPopper size={14} color="var(--tone-color)" />}
        </div>
        <div className={styles.celebrationMeta}>
          {entry.designation ? `${entry.designation} · ` : ''}
          {entry.department || '—'}
          {entry.employeeId ? ` · ${entry.employeeId}` : ''}
        </div>
      </div>

      <div className={styles.celebrationDateWrap}>
        <div className={styles.celebrationDate}>
          {formatDateShort(entry.date)}
          {entry.years ? <span className={styles.celebrationYears}> · {entry.years}yr</span> : null}
        </div>
        <DaysLabel days={entry.daysAway} />
      </div>
    </div>
  );
}

interface StatCardProps {
  icon: typeof Cake;
  label: string;
  value: number;
  tone: 'brand' | 'info' | 'warning' | 'success';
}

const STAT_TONE_CLASS = { brand: styles.toneBrand, info: styles.toneInfo, warning: styles.toneWarning, success: styles.toneSuccess } as const;

function StatCard({ icon: Icon, label, value, tone }: StatCardProps) {
  return (
    <div className={`${historyStyles.summaryCard} ${styles.statCard} ${STAT_TONE_CLASS[tone]}`}>
      <div className={styles.statCardHead}>
        <Icon size={16} color="var(--tone-color)" strokeWidth={2.2} />
        <span className={styles.statCardLabel}>{label}</span>
      </div>
      <span className={styles.statCardValue}>{value}</span>
    </div>
  );
}

export default function HrDashboardView() {
  const toast = useToast();
  const [birthdays, setBirthdays] = useState<CelebrationEntry[]>([]);
  const [anniversaries, setAnniversaries] = useState<CelebrationEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  function load() {
    setLoading(true);
    setLoadFailed(false);
    fetch('/api/hr-dashboard')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        setBirthdays(data.birthdays || []);
        setAnniversaries(data.anniversaries || []);
        setLoading(false);
      })
      .catch(() => {
        toast.error('Could not load the HR dashboard. Please try again.');
        setLoadFailed(true);
        setLoading(false);
      });
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const todayBirthdays = birthdays.filter((b) => b.isToday).length;
  const todayAnniversaries = anniversaries.filter((a) => a.isToday).length;

  return (
    <AppShell title="HR Dashboard" subtitle="Upcoming birthdays and work anniversaries in the next 30 days.">
      {loading ? (
        <div className={historyStyles.tableWrap}>
          <SkeletonRows rows={6} columns={4} />
        </div>
      ) : loadFailed ? (
        <div className={historyStyles.status}>
          Could not reach the server.{' '}
          <button type="button" className={historyStyles.button} onClick={load}>
            Retry
          </button>
        </div>
      ) : (
        <>
          <div className={historyStyles.summaryCardGrid}>
            <StatCard icon={Cake} label="Birthdays Today" value={todayBirthdays} tone="brand" />
            <StatCard icon={Award} label="Anniversaries Today" value={todayAnniversaries} tone="info" />
            <StatCard icon={CalendarDays} label="Upcoming Birthdays" value={birthdays.length} tone="warning" />
            <StatCard icon={CalendarDays} label="Upcoming Anniversaries" value={anniversaries.length} tone="success" />
          </div>

          {/* Responsive two-panel layout — collapses to one column below
              ~680px instead of a hard-coded 1fr/1fr grid that would squeeze
              both panels illegibly on mobile/tablet. */}
          <div className={styles.panelGrid}>
            <div className={styles.panel}>
              <div className={`${styles.panelHeader} ${styles.toneBrand}`}>
                <Cake size={18} color="var(--tone-color)" strokeWidth={2.2} />
                <h2 className={styles.panelTitle}>Upcoming Birthdays</h2>
                <span className={styles.panelCount}>{birthdays.length}</span>
              </div>
              {birthdays.length === 0 ? (
                <CelebrationEmptyState icon={Cake} message="No upcoming birthdays in the next 30 days" />
              ) : (
                birthdays.map((b, i) => <CelebrationCard key={`bd-${i}`} entry={b} type="birthday" />)
              )}
            </div>

            <div className={styles.panel}>
              <div className={`${styles.panelHeader} ${styles.toneInfo}`}>
                <Award size={18} color="var(--tone-color)" strokeWidth={2.2} />
                <h2 className={styles.panelTitle}>Work Anniversaries</h2>
                <span className={styles.panelCount}>{anniversaries.length}</span>
              </div>
              {anniversaries.length === 0 ? (
                <CelebrationEmptyState icon={Award} message="No upcoming work anniversaries in the next 30 days" />
              ) : (
                anniversaries.map((a, i) => <CelebrationCard key={`ann-${i}`} entry={a} type="anniversary" />)
              )}
            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}
