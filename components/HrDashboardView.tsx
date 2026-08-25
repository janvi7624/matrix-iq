'use client';

import { useEffect, useState } from 'react';
import { useToast } from './ui/ToastProvider';
import { Cake, Award, PartyPopper, CalendarDays } from 'lucide-react';

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
  if (days === 0) return <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: 'var(--mx-brand)', padding: '2px 10px', borderRadius: 'var(--mx-radius-full)' }}>Today</span>;
  if (days === 1) return <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--mx-warning)', background: 'var(--mx-warning-subtle)', padding: '2px 10px', borderRadius: 'var(--mx-radius-full)' }}>Tomorrow</span>;
  return <span style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', background: 'var(--mx-surface-sunken)', padding: '2px 10px', borderRadius: 'var(--mx-radius-full)' }}>in {days} days</span>;
}

function EmptyState({ icon: Icon, message }: { icon: typeof Cake; message: string }) {
  return (
    <div style={{ padding: '40px 20px', textAlign: 'center', color: '#9ca3af' }}>
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
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14, padding: '14px 20px',
      borderBottom: '1px solid var(--mx-border)',
      background: entry.isToday ? accentBg : 'transparent',
      transition: 'background 0.15s',
    }}>
      <div style={{
        width: 44, height: 44, borderRadius: 'var(--mx-radius-md)', flexShrink: 0,
        background: accentBg, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {isBirthday
          ? <Cake size={20} color={accent} strokeWidth={2} />
          : <Award size={20} color={accent} strokeWidth={2} />}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>{entry.name}</span>
          {entry.isToday && <PartyPopper size={14} color={accent} />}
        </div>
        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
          {entry.designation ? `${entry.designation} · ` : ''}{entry.department || '—'}
          {entry.employeeId ? ` · ${entry.employeeId}` : ''}
        </div>
      </div>

      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
          {formatDateShort(entry.date)}
          {entry.years ? <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 500 }}> · {entry.years}yr</span> : null}
        </div>
        <DaysLabel days={entry.daysAway} />
      </div>
    </div>
  );
}

export default function HrDashboardView() {
  const toast = useToast();
  const [birthdays, setBirthdays] = useState<CelebrationEntry[]>([]);
  const [anniversaries, setAnniversaries] = useState<CelebrationEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/hr-dashboard')
      .then((r) => r.json())
      .then((data) => {
        setBirthdays(data.birthdays || []);
        setAnniversaries(data.anniversaries || []);
        setLoading(false);
      })
      .catch(() => { toast.error('Failed to load HR dashboard'); setLoading(false); });
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div style={{ width: 36, height: 36, border: '3px solid var(--mx-border)', borderTopColor: 'var(--mx-brand)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  const todayBirthdays = birthdays.filter((b) => b.isToday).length;
  const todayAnniversaries = anniversaries.filter((a) => a.isToday).length;

  return (
    <div style={{ padding: '28px 32px 48px' }}>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#111827' }}>HR Dashboard</h1>
        <p style={{ margin: '4px 0 0', fontSize: 14, color: '#6b7280' }}>Upcoming birthdays and work anniversaries in the next 30 days</p>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        <div style={{ padding: '18px 20px', borderRadius: 'var(--mx-radius-md)', background: 'var(--mx-brand-subtle)', border: '1px solid var(--mx-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Cake size={16} color="var(--mx-brand)" strokeWidth={2.2} />
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--mx-brand)', textTransform: 'uppercase', letterSpacing: 0.4 }}>Birthdays Today</span>
          </div>
          <span style={{ fontSize: 28, fontWeight: 800, color: '#111827' }}>{todayBirthdays}</span>
        </div>
        <div style={{ padding: '18px 20px', borderRadius: 'var(--mx-radius-md)', background: 'var(--mx-info-subtle)', border: '1px solid var(--mx-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Award size={16} color="var(--mx-info)" strokeWidth={2.2} />
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--mx-info)', textTransform: 'uppercase', letterSpacing: 0.4 }}>Anniversaries Today</span>
          </div>
          <span style={{ fontSize: 28, fontWeight: 800, color: '#111827' }}>{todayAnniversaries}</span>
        </div>
        <div style={{ padding: '18px 20px', borderRadius: 'var(--mx-radius-md)', background: 'var(--mx-warning-subtle)', border: '1px solid var(--mx-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <CalendarDays size={16} color="var(--mx-warning)" strokeWidth={2.2} />
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--mx-warning)', textTransform: 'uppercase', letterSpacing: 0.4 }}>Upcoming Birthdays</span>
          </div>
          <span style={{ fontSize: 28, fontWeight: 800, color: '#111827' }}>{birthdays.length}</span>
        </div>
        <div style={{ padding: '18px 20px', borderRadius: 'var(--mx-radius-md)', background: 'var(--mx-success-subtle)', border: '1px solid var(--mx-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <CalendarDays size={16} color="var(--mx-success)" strokeWidth={2.2} />
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--mx-success)', textTransform: 'uppercase', letterSpacing: 0.4 }}>Upcoming Anniversaries</span>
          </div>
          <span style={{ fontSize: 28, fontWeight: 800, color: '#111827' }}>{anniversaries.length}</span>
        </div>
      </div>

      {/* Two-column layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

        {/* Birthdays */}
        <div style={{ background: 'var(--mx-surface)', borderRadius: 'var(--mx-radius-xl)', border: '1px solid var(--mx-border)', overflow: 'hidden' }}>
          <div style={{
            padding: '16px 20px', borderBottom: '1px solid var(--mx-border)',
            display: 'flex', alignItems: 'center', gap: 10,
            background: 'var(--mx-brand-subtle)',
          }}>
            <Cake size={18} color="var(--mx-brand)" strokeWidth={2.2} />
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#111827' }}>
              Upcoming Birthdays
            </h2>
            <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: 'var(--mx-brand)', background: '#fff', padding: '2px 10px', borderRadius: 'var(--mx-radius-full)' }}>
              {birthdays.length}
            </span>
          </div>
          {birthdays.length === 0
            ? <EmptyState icon={Cake} message="No upcoming birthdays in the next 30 days" />
            : birthdays.map((b, i) => <CelebrationCard key={`bd-${i}`} entry={b} type="birthday" />)}
        </div>

        {/* Anniversaries */}
        <div style={{ background: 'var(--mx-surface)', borderRadius: 'var(--mx-radius-xl)', border: '1px solid var(--mx-border)', overflow: 'hidden' }}>
          <div style={{
            padding: '16px 20px', borderBottom: '1px solid var(--mx-border)',
            display: 'flex', alignItems: 'center', gap: 10,
            background: 'var(--mx-info-subtle)',
          }}>
            <Award size={18} color="var(--mx-info)" strokeWidth={2.2} />
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#111827' }}>
              Work Anniversaries
            </h2>
            <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: 'var(--mx-info)', background: '#fff', padding: '2px 10px', borderRadius: 'var(--mx-radius-full)' }}>
              {anniversaries.length}
            </span>
          </div>
          {anniversaries.length === 0
            ? <EmptyState icon={Award} message="No upcoming work anniversaries in the next 30 days" />
            : anniversaries.map((a, i) => <CelebrationCard key={`ann-${i}`} entry={a} type="anniversary" />)}
        </div>
      </div>
    </div>
  );
}
