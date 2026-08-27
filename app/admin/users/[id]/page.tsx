'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { PublicUser, RoleRecord } from '@/lib/types';
import AppShell from '@/components/AppShell';
import historyStyles from '@/components/quotationHistory.module.css';
import calcStyles from '@/components/calculator.module.css';

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
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 0', borderBottom: '1px solid #f1f2f4', fontSize: 13.5 }}>
      <span style={{ color: '#6b7280' }}>{label}</span>
      <span style={{ fontWeight: 600, textAlign: 'right' }}>{value || '-'}</span>
    </div>
  );
}

function ActivityGroup({ title, section, hrefBase }: { title: string; section: ActivitySection; hrefBase?: string }) {
  return (
    <div className={calcStyles.sectionPanel} style={{ flex: 1, minWidth: 240 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5 }}>{title}</div>
        <div style={{ fontWeight: 700, color: '#dc2626' }}>{section.total}</div>
      </div>
      {section.recent.length === 0 ? (
        <div className={calcStyles.small}>None yet.</div>
      ) : (
        section.recent.map((item) => (
          <div key={item.id} style={{ fontSize: 12.5, padding: '4px 0', borderBottom: '1px solid #f6f7f8' }}>
            {hrefBase ? <Link href={`${hrefBase}/${item.id}`}>{item.label}</Link> : item.label}
            <span style={{ color: '#9ca3af' }}> — {item.status} · {formatDateTime(item.at)}</span>
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
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 18 }}>
            <Link className={historyStyles.button} href={`/admin/performance-review?user=${encodeURIComponent(user.username)}`}>
              View Full Performance Review →
            </Link>
          </div>
        )}
        {user === undefined && <div className={historyStyles.status}>Loading profile...</div>}
        {user === null && <div className={historyStyles.status}>Employee not found.</div>}
        {user && (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
              <span className={`${historyStyles.statusPill} ${user.status === 'active' ? historyStyles.statusPillActive : historyStyles.statusPillInactive}`}>
                {user.status === 'active' ? 'Active' : 'Inactive'}
              </span>
              <span className={`${historyStyles.rolePill} ${historyStyles.rolePillUser}`}>{roleLabel}</span>
              {user.mustChangePassword && (
                <span className={historyStyles.followUpBadge}>Password change pending</span>
              )}
            </div>

            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
              <div className={calcStyles.sectionPanel} style={{ flex: 1, minWidth: 260 }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Personal Information</div>
                <InfoRow label="Full Name" value={user.name} />
                <InfoRow label="Email" value={user.email} />
                <InfoRow label="Phone" value={user.phone} />
                <InfoRow label="Location" value={user.location} />
              </div>
              <div className={calcStyles.sectionPanel} style={{ flex: 1, minWidth: 260 }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Organization Information</div>
                <InfoRow label="Employee ID" value={user.employeeId} />
                <InfoRow label="Department" value={user.department} />
                <InfoRow label="Designation" value={user.designation} />
              </div>
              <div className={calcStyles.sectionPanel} style={{ flex: 1, minWidth: 260 }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>MatrixIQ Account</div>
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
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  <ActivityGroup title="Projects" section={activity.projects} hrefBase="/projects" />
                  <ActivityGroup title="Site Visits" section={activity.siteVisits} />
                  <ActivityGroup title="Quotations" section={activity.quotations} />
                  <ActivityGroup title="Demo Requests" section={activity.demoRequests} />
                </div>
                <div className={calcStyles.sectionPanel} style={{ marginTop: 16 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 8 }}>Recent Login History</div>
                  {activity.loginHistory.length === 0 ? (
                    <div className={calcStyles.small}>No logins recorded yet.</div>
                  ) : (
                    activity.loginHistory.slice(0, 10).map((h) => (
                      <div key={h.id} style={{ fontSize: 12.5, padding: '4px 0', borderBottom: '1px solid #f6f7f8' }}>
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
