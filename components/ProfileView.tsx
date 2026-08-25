'use client';

import { useEffect, useState } from 'react';
import { useToast } from './ui/ToastProvider';
import {
  User, Building2, Briefcase, Phone, Mail, Cake, CalendarCheck, MapPin, Hash,
} from 'lucide-react';

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

  useEffect(() => {
    fetch('/api/profile')
      .then((r) => r.json())
      .then((data) => { setProfile(data); setLoading(false); })
      .catch(() => { toast.error('Failed to load profile'); setLoading(false); });
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div style={{ width: 36, height: 36, border: '3px solid var(--mx-border)', borderTopColor: 'var(--mx-brand)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!profile) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', color: '#6b7280', fontSize: 15 }}>
        Could not load profile.
      </div>
    );
  }

  const initials = profile.name
    ? profile.name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('')
    : '?';

  const infoCards: { icon: typeof User; label: string; value: string; color: string; bg: string }[] = [
    { icon: Hash, label: 'Employee ID', value: profile.employeeId || '—', color: 'var(--mx-brand)', bg: 'var(--mx-brand-subtle)' },
    { icon: Building2, label: 'Department', value: profile.department || '—', color: 'var(--mx-info)', bg: 'var(--mx-info-subtle)' },
    { icon: Briefcase, label: 'Designation', value: profile.designation || '—', color: 'var(--mx-success)', bg: 'var(--mx-success-subtle)' },
    { icon: MapPin, label: 'Location', value: profile.location || '—', color: 'var(--mx-warning)', bg: 'var(--mx-warning-subtle)' },
  ];

  const detailRows: { icon: typeof User; label: string; value: string; color: string }[] = [
    { icon: Phone, label: 'Mobile No', value: profile.phone || '—', color: 'var(--mx-success)' },
    { icon: Mail, label: 'Email', value: profile.email || '—', color: 'var(--mx-info)' },
    { icon: Cake, label: 'Birthday', value: formatDate(profile.birthday), color: 'var(--mx-brand)' },
    { icon: CalendarCheck, label: 'Date of Joining', value: formatDate(profile.dateOfJoining), color: 'var(--mx-warning)' },
  ];

  return (
    <div style={{ padding: '28px 32px 48px' }}>

      {/* ── Hero card with banner ── */}
      <div style={{
        background: 'var(--mx-surface)', borderRadius: 'var(--mx-radius-xl)',
        border: '1px solid var(--mx-border)', overflow: 'hidden',
      }}>
        <div style={{
          height: 120, background: 'linear-gradient(135deg, #111827 0%, #1f2937 60%, var(--mx-brand) 100%)',
        }} />

        <div style={{ padding: '0 36px 32px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginTop: 20 }}>
            <div style={{
              width: 80, height: 80, borderRadius: 'var(--mx-radius-lg)', flexShrink: 0,
              background: 'linear-gradient(135deg, var(--mx-brand), var(--mx-brand-hover))',
              color: '#fff', fontSize: 28, fontWeight: 800, letterSpacing: 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            }}>
              {initials}
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: '#111827', letterSpacing: -0.3 }}>
                {profile.name || 'Employee'}
              </h1>
              <p style={{ margin: '4px 0 0', fontSize: 14, color: '#6b7280' }}>
                {profile.designation || ''}{profile.designation && profile.department ? '  ·  ' : ''}{profile.department || ''}
              </p>
            </div>
          </div>

          {/* ── Quick info tiles — always 4 columns on desktop ── */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 16, marginTop: 28,
          }}>
            {infoCards.map(({ icon: Icon, label, value, color, bg }) => (
              <div key={label} style={{
                padding: '16px 20px', borderRadius: 'var(--mx-radius-md)',
                background: bg, display: 'flex', flexDirection: 'column', gap: 10,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <Icon size={15} color={color} strokeWidth={2.2} />
                  <span style={{ fontSize: 11, fontWeight: 600, color, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</span>
                </div>
                <span style={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Contact & Personal — 2-column grid ── */}
      <div style={{
        marginTop: 20, background: 'var(--mx-surface)', borderRadius: 'var(--mx-radius-xl)',
        border: '1px solid var(--mx-border)', padding: '24px 36px 20px',
      }}>
        <h2 style={{ margin: '0 0 20px', fontSize: 14, fontWeight: 700, color: '#111827', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Contact & Personal
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 32px' }}>
          {detailRows.map(({ icon: Icon, label, value, color }, i) => (
            <div key={label} style={{
              display: 'flex', alignItems: 'center', gap: 14,
              padding: '16px 0',
              borderBottom: i < detailRows.length - 2 ? '1px solid var(--mx-border)' : 'none',
            }}>
              <div style={{
                width: 40, height: 40, borderRadius: 'var(--mx-radius-sm)',
                background: `${color}14`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <Icon size={18} color={color} strokeWidth={2} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#111827', marginTop: 2, wordBreak: 'break-word' }}>{value}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
