'use client';

import { useEffect, useState } from 'react';
import { useToast } from './ui/ToastProvider';
import {
  User, Building2, Briefcase, Phone, Mail, Cake, CalendarCheck, MapPin, Hash,
} from 'lucide-react';
import AppShell from './AppShell';
import { SkeletonRows } from './ui/Skeleton';
import historyStyles from './quotationHistory.module.css';

interface ProfileData {
  name: string;
  employeeId: string;
  department: string;
  designation: string;
  phone: string;
  email: string;
  birthday: string;
  dateOfJoining: string;
  location: string;
}

function formatDate(val: string): string {
  if (!val) return '—';
  const d = new Date(val + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function ProfileView() {
  const toast = useToast();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  function load() {
    setLoading(true);
    setLoadFailed(false);
    fetch('/api/profile')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => { setProfile(data); setLoading(false); })
      .catch(() => { toast.error('Could not load your profile.'); setLoadFailed(true); setLoading(false); });
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initials = profile?.name
    ? profile.name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('')
    : '?';

  const infoCards: { icon: typeof User; label: string; value: string; color: string; bg: string }[] = profile
    ? [
        { icon: Hash, label: 'Employee ID', value: profile.employeeId || '—', color: 'var(--mx-brand)', bg: 'var(--mx-brand-subtle)' },
        { icon: Building2, label: 'Department', value: profile.department || '—', color: 'var(--mx-info)', bg: 'var(--mx-info-subtle)' },
        { icon: Briefcase, label: 'Designation', value: profile.designation || '—', color: 'var(--mx-success)', bg: 'var(--mx-success-subtle)' },
        { icon: MapPin, label: 'Location', value: profile.location || '—', color: 'var(--mx-warning)', bg: 'var(--mx-warning-subtle)' }
      ]
    : [];

  const detailRows: { icon: typeof User; label: string; value: string; color: string }[] = profile
    ? [
        { icon: Phone, label: 'Mobile No', value: profile.phone || '—', color: 'var(--mx-success)' },
        { icon: Mail, label: 'Email', value: profile.email || '—', color: 'var(--mx-info)' },
        { icon: Cake, label: 'Birthday', value: formatDate(profile.birthday), color: 'var(--mx-brand)' },
        { icon: CalendarCheck, label: 'Date of Joining', value: formatDate(profile.dateOfJoining), color: 'var(--mx-warning)' }
      ]
    : [];

  return (
    <AppShell title="My Profile" subtitle="Your employee details on file.">
      {loading ? (
        <div className={historyStyles.tableWrap}>
          <SkeletonRows rows={5} columns={4} />
        </div>
      ) : loadFailed || !profile ? (
        <div className={historyStyles.status}>
          Could not load your profile.{' '}
          <button type="button" className={historyStyles.button} onClick={load}>
            Retry
          </button>
        </div>
      ) : (
        <>
          {/* Hero card with banner */}
          <div style={{ background: 'var(--mx-surface)', borderRadius: 'var(--mx-radius-xl)', border: '1px solid var(--mx-border)', overflow: 'hidden' }}>
            <div style={{ height: 120, background: 'linear-gradient(135deg, var(--mx-ink) 0%, #1f2937 60%, var(--mx-brand) 100%)' }} />

            <div style={{ padding: '0 36px 32px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginTop: 20, flexWrap: 'wrap' }}>
                <div
                  style={{
                    width: 80,
                    height: 80,
                    borderRadius: 'var(--mx-radius-lg)',
                    flexShrink: 0,
                    background: 'linear-gradient(135deg, var(--mx-brand), var(--mx-brand-hover))',
                    color: '#fff',
                    fontSize: 28,
                    fontWeight: 800,
                    letterSpacing: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: 'var(--mx-shadow-sm)'
                  }}
                >
                  {initials}
                </div>
                <div>
                  <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: 'var(--mx-ink)', letterSpacing: -0.3 }}>{profile.name || 'Employee'}</h1>
                  <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--mx-ink-muted)' }}>
                    {profile.designation || ''}
                    {profile.designation && profile.department ? '  ·  ' : ''}
                    {profile.department || ''}
                  </p>
                </div>
              </div>

              {/* Quick info tiles — responsive, not a rigid 4-column grid */}
              <div className={historyStyles.summaryCardGrid} style={{ marginTop: 28, marginBottom: 0 }}>
                {infoCards.map(({ icon: Icon, label, value, color, bg }) => (
                  <div key={label} style={{ padding: '16px 20px', borderRadius: 'var(--mx-radius-md)', background: bg, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <Icon size={15} color={color} strokeWidth={2.2} />
                      <span style={{ fontSize: 11, fontWeight: 600, color, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</span>
                    </div>
                    <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--mx-ink)' }}>{value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Contact & Personal */}
          <div style={{ marginTop: 20, background: 'var(--mx-surface)', borderRadius: 'var(--mx-radius-xl)', border: '1px solid var(--mx-border)', padding: '24px 36px 20px' }}>
            <h2 style={{ margin: '0 0 20px', fontSize: 14, fontWeight: 700, color: 'var(--mx-ink)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Contact & Personal</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0 32px' }}>
              {detailRows.map(({ icon: Icon, label, value, color }, i) => (
                <div
                  key={label}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    padding: '16px 0',
                    borderBottom: i < detailRows.length - 2 ? '1px solid var(--mx-border)' : 'none'
                  }}
                >
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 'var(--mx-radius-sm)',
                      background: `${color}14`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0
                    }}
                  >
                    <Icon size={18} color={color} strokeWidth={2} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: 'var(--mx-ink-faint)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--mx-ink)', marginTop: 2, wordBreak: 'break-word' }}>{value}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}
