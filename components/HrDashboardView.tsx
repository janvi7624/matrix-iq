'use client';

import { useEffect, useState } from 'react';
import { Cake, Award, PartyPopper, CalendarDays } from 'lucide-react';
import AppShell from './AppShell';
import { useToast } from './ui/ToastProvider';
import { SkeletonRows } from './ui/Skeleton';
import historyStyles from './quotationHistory.module.css';

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
    return (
      <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: 'var(--mx-brand)', padding: '2px 10px', borderRadius: 'var(--mx-radius-full)' }}>
        Today
      </span>
    );
  }
  if (days === 1) {
    return (
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--mx-warning)', background: 'var(--mx-warning-subtle)', padding: '2px 10px', borderRadius: 'var(--mx-radius-full)' }}>
        Tomorrow
      </span>
    );
  }
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--mx-ink-muted)', background: 'var(--mx-surface-sunken)', padding: '2px 10px', borderRadius: 'var(--mx-radius-full)' }}>
      in {days} days
    </span>
  );
}

function CelebrationEmptyState({ icon: Icon, message }: { icon: typeof Cake; message: string }) {
  return (
    <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--mx-ink-faint)' }}>
      <Icon size={32} strokeWidth={1.5} style={{ marginBottom: 10, opacity: 0.5 }} />
      <p style={{ margin: 0, fontSize: 14 }}>{message}</p>
    </div>
  );
}

function CelebrationCard({ entry, type }: { entry: CelebrationEntry; type: 'birthday' | 'anniversary' }) {
  const isBirthday = type === 'birthday';
  const accent = isBirthday ? 'var(--mx-brand)' : 'var(--mx-info)';
  const accentBg = isBirthday ? 'var(--mx-brand-subtle)' : 'var(--mx-info-subtle)';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '14px 20px',
        borderBottom: '1px solid var(--mx-border)',
        background: entry.isToday ? accentBg : 'transparent'
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 'var(--mx-radius-md)',
          flexShrink: 0,
          background: accentBg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        {isBirthday ? <Cake size={20} color={accent} strokeWidth={2} /> : <Award size={20} color={accent} strokeWidth={2} />}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--mx-ink)' }}>{entry.name}</span>
          {entry.isToday && <PartyPopper size={14} color={accent} />}
        </div>
        <div style={{ fontSize: 12, color: 'var(--mx-ink-muted)', marginTop: 2 }}>
          {entry.designation ? `${entry.designation} · ` : ''}
          {entry.department || '—'}
          {entry.employeeId ? ` · ${entry.employeeId}` : ''}
        </div>
      </div>

      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--mx-ink)', marginBottom: 4 }}>
          {formatDateShort(entry.date)}
          {entry.years ? <span style={{ fontSize: 11, color: 'var(--mx-ink-faint)', fontWeight: 500 }}> · {entry.years}yr</span> : null}
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

function StatCard({ icon: Icon, label, value, tone }: StatCardProps) {
  return (
    <div
      className={historyStyles.summaryCard}
      style={{ background: `var(--mx-${tone}-subtle)`, border: '1px solid var(--mx-border)' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Icon size={16} color={`var(--mx-${tone})`} strokeWidth={2.2} />
        <span style={{ fontSize: 11, fontWeight: 600, color: `var(--mx-${tone})`, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</span>
      </div>
      <span style={{ fontSize: 28, fontWeight: 800, color: 'var(--mx-ink)' }}>{value}</span>
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
            <div style={{ background: 'var(--mx-surface)', borderRadius: 'var(--mx-radius-xl)', border: '1px solid var(--mx-border)', overflow: 'hidden' }}>
              <div
                style={{
                  padding: '16px 20px',
                  borderBottom: '1px solid var(--mx-border)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  background: 'var(--mx-brand-subtle)'
                }}
              >
                <Cake size={18} color="var(--mx-brand)" strokeWidth={2.2} />
                <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--mx-ink)' }}>Upcoming Birthdays</h2>
                <span
                  style={{
                    marginLeft: 'auto',
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--mx-brand)',
                    background: 'var(--mx-surface)',
                    padding: '2px 10px',
                    borderRadius: 'var(--mx-radius-full)'
                  }}
                >
                  {birthdays.length}
                </span>
              </div>
              {birthdays.length === 0 ? (
                <CelebrationEmptyState icon={Cake} message="No upcoming birthdays in the next 30 days" />
              ) : (
                birthdays.map((b, i) => <CelebrationCard key={`bd-${i}`} entry={b} type="birthday" />)
              )}
            </div>

            <div style={{ background: 'var(--mx-surface)', borderRadius: 'var(--mx-radius-xl)', border: '1px solid var(--mx-border)', overflow: 'hidden' }}>
              <div
                style={{
                  padding: '16px 20px',
                  borderBottom: '1px solid var(--mx-border)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  background: 'var(--mx-info-subtle)'
                }}
              >
                <Award size={18} color="var(--mx-info)" strokeWidth={2.2} />
                <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--mx-ink)' }}>Work Anniversaries</h2>
                <span
                  style={{
                    marginLeft: 'auto',
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--mx-info)',
                    background: 'var(--mx-surface)',
                    padding: '2px 10px',
                    borderRadius: 'var(--mx-radius-full)'
                  }}
                >
                  {anniversaries.length}
                </span>
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
