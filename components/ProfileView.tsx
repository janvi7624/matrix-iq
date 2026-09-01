'use client';

import { useEffect, useState } from 'react';
import { useToast } from './ui/ToastProvider';
import {
  User, Building2, Briefcase, Phone, Mail, Cake, CalendarCheck, MapPin, Hash,
} from 'lucide-react';
import AppShell from './AppShell';
import { SkeletonRows } from './ui/Skeleton';
import historyStyles from './quotationHistory.module.css';
import styles from './profileView.module.css';

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

type Tone = 'brand' | 'info' | 'success' | 'warning';

const TONE_TEXT: Record<Tone, string> = {
  brand: styles.toneBrand,
  info: styles.toneInfo,
  success: styles.toneSuccess,
  warning: styles.toneWarning
};
const TONE_BG: Record<Tone, string> = {
  brand: styles.toneBrandBg,
  info: styles.toneInfoBg,
  success: styles.toneSuccessBg,
  warning: styles.toneWarningBg
};

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

  const infoCards: { icon: typeof User; label: string; value: string; tone: Tone }[] = profile
    ? [
        { icon: Hash, label: 'Employee ID', value: profile.employeeId || '—', tone: 'brand' },
        { icon: Building2, label: 'Department', value: profile.department || '—', tone: 'info' },
        { icon: Briefcase, label: 'Designation', value: profile.designation || '—', tone: 'success' },
        { icon: MapPin, label: 'Location', value: profile.location || '—', tone: 'warning' }
      ]
    : [];

  const detailRows: { icon: typeof User; label: string; value: string; tone: Tone }[] = profile
    ? [
        { icon: Phone, label: 'Mobile No', value: profile.phone || '—', tone: 'success' },
        { icon: Mail, label: 'Email', value: profile.email || '—', tone: 'info' },
        { icon: Cake, label: 'Birthday', value: formatDate(profile.birthday), tone: 'brand' },
        { icon: CalendarCheck, label: 'Date of Joining', value: formatDate(profile.dateOfJoining), tone: 'warning' }
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
          <div className={styles.heroCard}>
            <div className={styles.heroBanner} />

            <div className={styles.heroBody}>
              <div className={styles.heroTop}>
                <div className={styles.avatar}>{initials}</div>
                <div>
                  <h1 className={styles.nameHeading}>{profile.name || 'Employee'}</h1>
                  <p className={styles.nameSub}>
                    {profile.designation || ''}
                    {profile.designation && profile.department ? '  ·  ' : ''}
                    {profile.department || ''}
                  </p>
                </div>
              </div>

              {/* Quick info tiles — responsive, not a rigid 4-column grid */}
              <div className={`${historyStyles.summaryCardGrid} ${styles.infoGrid}`}>
                {infoCards.map(({ icon: Icon, label, value, tone }) => (
                  <div key={label} className={`${styles.infoTile} ${TONE_BG[tone]}`}>
                    <div className={styles.infoTileHead}>
                      <Icon size={15} strokeWidth={2.2} className={TONE_TEXT[tone]} />
                      <span className={`${styles.infoTileLabel} ${TONE_TEXT[tone]}`}>{label}</span>
                    </div>
                    <span className={styles.infoTileValue}>{value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Contact & Personal */}
          <div className={styles.detailCard}>
            <h2 className={styles.detailHeading}>Contact & Personal</h2>
            <div className={styles.detailGrid}>
              {detailRows.map(({ icon: Icon, label, value, tone }, i) => (
                <div
                  key={label}
                  className={`${styles.detailRow} ${i >= detailRows.length - 2 ? styles.detailRowNoBorder : ''}`}
                >
                  <div className={`${styles.detailIcon} ${TONE_BG[tone]}`}>
                    <Icon size={18} strokeWidth={2} className={TONE_TEXT[tone]} />
                  </div>
                  <div className={styles.detailBody}>
                    <div className={styles.detailLabel}>{label}</div>
                    <div className={styles.detailValue}>{value}</div>
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
