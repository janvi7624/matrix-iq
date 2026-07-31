import Link from 'next/link';
import Image from 'next/image';
import { ROLE_CAPABILITIES, CapabilityLevel } from '@/lib/roleCapabilities';
import { UserRole } from '@/lib/types';
import { BRAND } from '@/lib/branding';
import styles from '@/components/quotationHistory.module.css';

const ROLE_ORDER: UserRole[] = ['superadmin', 'admin', 'manager', 'technical', 'backoffice', 'user'];
const ROLE_LABELS: Record<UserRole, string> = { superadmin: 'Super Admin', admin: 'Admin', manager: 'Manager', technical: 'Technical', backoffice: 'Back Office', user: 'User' };

function LevelBadge({ level }: { level: CapabilityLevel }) {
  if (level === 'yes') return <span style={{ color: '#15803d', fontWeight: 700 }}>Yes</span>;
  if (level === 'own') return <span style={{ color: '#a16207', fontWeight: 700 }}>Own only</span>;
  return <span style={{ color: '#9ca3af' }}>No</span>;
}

export default function RoleManagementPage() {
  return (
    <div className={styles.body}>
      <header className={styles.header}>
        <div className={styles.headerBrand}>
          <Image src="/NANTA.png" alt={`${BRAND.companyName} logo`} width={38} height={38} className={styles.headerLogo} unoptimized />
          <div>
            <h1>Role Management</h1>
            <div className={styles.sub}>Administration &rsaquo; what each role can see and do across {BRAND.appName}.</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <Link className={styles.button} href="/admin/users">User Management</Link>
          <Link className={styles.button} href="/">Back to Dashboard</Link>
        </div>
      </header>
      <main className={styles.main}>
        <div className={styles.status} style={{ marginBottom: 16 }}>
          Roles are fixed platform roles, not custom-defined — this page is a reference for what each one can do today. Assign a role to a user from{' '}
          <Link href="/admin/users">User Management</Link>.
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Capability</th>
                {ROLE_ORDER.map((r) => (
                  <th key={r} style={{ textAlign: 'center' }}>{ROLE_LABELS[r]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROLE_CAPABILITIES.map((row) => (
                <tr key={row.capability}>
                  <td>
                    {row.capability}
                    {row.note && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{row.note}</div>}
                  </td>
                  {ROLE_ORDER.map((r) => (
                    <td key={r} style={{ textAlign: 'center' }}>
                      <LevelBadge level={row.roles[r]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
