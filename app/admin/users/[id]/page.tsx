'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { PublicUser, RoleRecord } from '@/lib/types';
import AppShell from '@/components/AppShell';
import historyStyles from '@/components/quotationHistory.module.css';
import calcStyles from '@/components/calculator.module.css';
import styles from './profilePage.module.css';

interface ActivityItem { id: string; label: string; status: string; at: string; }
interface ActivitySection { total: number; recent: ActivityItem[]; }
interface LoginHistoryEntry { id: string; at: string; success: boolean; ip: string; }
interface UserActivity {
  projects: ActivitySection;
  siteVisits: ActivitySection;
  quotations: ActivitySection;
  demoRequests: ActivitySection;
  loginHistory: LoginHistoryEntry[];
}

function formatDateTime(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('en-IN');
  } catch {
    return iso;
  }
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.infoRow}>
      <span className={styles.infoRowLabel}>{label}</span>
      <span className={styles.infoRowValue}>{value || '-'}</span>
    </div>
  );
}

function ActivityGroup({ title, section, hrefBase }: { title: string; section: ActivitySection; hrefBase?: string }) {
  return (
    <div className={`${calcStyles.sectionPanel} ${styles.activityGroupPanel}`}>
      <div className={styles.activityGroupHeader}>
        <div className={styles.activityGroupTitle}>{title}</div>
        <div className={styles.activityGroupCount}>{section.total}</div>
      </div>
      {section.recent.length === 0 ? (
        <div className={calcStyles.small}>None yet.</div>
      ) : (
        section.recent.map((item) => (
          <div key={item.id} className={styles.activityItemRow}>
            {hrefBase ? <Link href={`${hrefBase}/${item.id}`}>{item.label}</Link> : item.label}
            <span className={styles.mutedText}> — {item.status} · {formatDateTime(item.at)}</span>
          </div>
        ))
      )}
    </div>
  );
}

export default function EmployeeProfilePage() {
  const params = useParams<{ id: string }>();
  const [user, setUser] = useState<PublicUser | null | undefined>(undefined);
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [activity, setActivity] = useState<UserActivity | null>(null);
  const [activityLoading, setActivityLoading] = useState(true);

  useEffect(() => {
    fetch('/api/admin/users')
      .then((r) => (r.ok ? r.json() : []))
      .then((data: PublicUser[]) => setUser(data.find((u) => u.id === params.id) || null))
      .catch(() => setUser(null));
    fetch('/api/admin/roles')
      .then((r) => (r.ok ? r.json() : []))
      .then((data: RoleRecord[]) => setRoles(data))
      .catch(() => setRoles([]));
  }, [params.id]);

  useEffect(() => {
    if (!params.id) return;
    setActivityLoading(true);
    fetch(`/api/admin/users/${params.id}/activity`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: UserActivity | null) => setActivity(data))
      .finally(() => setActivityLoading(false));
  }, [params.id]);

  const roleLabel = roles.find((r) => r.key === user?.role)?.label || user?.role || '-';

  return (
    <AppShell title={user ? user.name : 'Employee Profile'} subtitle="Administration › User Management › Employee Profile">
        {user && (
          <div className={styles.topActionsRow}>
            <Link className={historyStyles.button} href={`/admin/performance-review?user=${encodeURIComponent(user.username)}`}>
              View Full Performance Review →
            </Link>
          </div>
        )}
        {user === undefined && <div className={historyStyles.status}>Loading profile...</div>}
        {user === null && <div className={historyStyles.status}>Employee not found.</div>}
        {user && (
          <>
            <div className={styles.badgeRow}>
              <span className={`${historyStyles.statusPill} ${user.status === 'active' ? historyStyles.statusPillActive : historyStyles.statusPillInactive}`}>
                {user.status === 'active' ? 'Active' : 'Inactive'}
              </span>
              <span className={`${historyStyles.rolePill} ${historyStyles.rolePillUser}`}>{roleLabel}</span>
              {user.mustChangePassword && (
                <span className={historyStyles.followUpBadge}>Password change pending</span>
              )}
            </div>

            <div className={styles.infoCardsRow}>
              <div className={`${calcStyles.sectionPanel} ${styles.infoCard}`}>
                <div className={styles.infoCardTitle}>Personal Information</div>
                <InfoRow label="Full Name" value={user.name} />
                <InfoRow label="Email" value={user.email} />
                <InfoRow label="Phone" value={user.phone} />
                <InfoRow label="Location" value={user.location} />
              </div>
              <div className={`${calcStyles.sectionPanel} ${styles.infoCard}`}>
                <div className={styles.infoCardTitle}>Organization Information</div>
                <InfoRow label="Employee ID" value={user.employeeId} />
                <InfoRow label="Department" value={user.department} />
                <InfoRow label="Designation" value={user.designation} />
              </div>
              <div className={`${calcStyles.sectionPanel} ${styles.infoCard}`}>
                <div className={styles.infoCardTitle}>MatrixIQ Account</div>
                <InfoRow label="Username" value={user.username} />
                <InfoRow label="Role" value={roleLabel} />
                <InfoRow label="Account Created" value={formatDateTime(user.createdAt)} />
                <InfoRow label="Last Login" value={formatDateTime(user.lastLoginAt)} />
              </div>
            </div>

            <h2 className={calcStyles.h2}>Activity</h2>
            {activityLoading ? (
              <div className={historyStyles.status}>Loading activity...</div>
            ) : activity ? (
              <>
                <div className={styles.activityGroupsRow}>
                  <ActivityGroup title="Projects" section={activity.projects} hrefBase="/projects" />
                  <ActivityGroup title="Site Visits" section={activity.siteVisits} />
                  <ActivityGroup title="Quotations" section={activity.quotations} />
                  <ActivityGroup title="Demo Requests" section={activity.demoRequests} />
                </div>
                <div className={`${calcStyles.sectionPanel} ${styles.mt16}`}>
                  <div className={styles.loginHistoryTitle}>Recent Login History</div>
                  {activity.loginHistory.length === 0 ? (
                    <div className={calcStyles.small}>No logins recorded yet.</div>
                  ) : (
                    activity.loginHistory.slice(0, 10).map((h) => (
                      <div key={h.id} className={styles.activityItemRow}>
                        {formatDateTime(h.at)} — {h.success ? 'Success' : 'Failed'} {h.ip ? `(${h.ip})` : ''}
                      </div>
                    ))
                  )}
                </div>
              </>
            ) : (
              <div className={historyStyles.status}>Could not load activity.</div>
            )}
          </>
        )}
    </AppShell>
  );
}
