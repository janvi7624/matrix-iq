'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { BRAND } from '@/lib/branding';
import { PARTNER_HOME } from '@/lib/partnerRoles';
import NotificationBell from './NotificationBell';
import SessionTimeoutWatcher from './SessionTimeoutWatcher';
import Sidebar from './Sidebar';
import historyStyles from './quotationHistory.module.css';
import shellStyles from './sidebar.module.css';

interface PartnerShellProps {
  title: string;
  subtitle: string;
  /** The partner company's name, shown so a multi-company user always knows whose portal they are in. */
  partnerName: string;
  partnerCode: string;
  children: React.ReactNode;
}

/**
 * The portal's chrome — the partner-side counterpart to AppShell.
 *
 * Reuses AppShell's exact layout, CSS modules and Sidebar so the portal is
 * visibly the same product rather than a bolted-on microsite. It is a
 * separate component rather than a prop on AppShell because of what it must
 * LEAVE OUT, not what it adds: AppShell's PortalHeader renders GlobalSearch
 * (which searches internal records) and a "Back to Dashboard" link to '/',
 * both of which a partner is blocked from. Shipping controls that 403 when
 * clicked would be worse than not shipping them.
 */
export default function PartnerShell({ title, subtitle, partnerName, partnerCode, children }: PartnerShellProps) {
  const router = useRouter();

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => null);
    router.push('/login');
    router.refresh();
  }

  return (
    <div className={historyStyles.body}>
      <SessionTimeoutWatcher />
      <header className={historyStyles.header}>
        <Link href={PARTNER_HOME} className={historyStyles.headerBrand}>
          <Image src={BRAND.logoWeb} alt={`${BRAND.companyName} logo`} width={38} height={38} className={historyStyles.headerLogo} unoptimized />
          <div>
            <div className={historyStyles.breadcrumb}>
              Partner Portal <span>›</span> {partnerName}
              {partnerCode ? ` (${partnerCode})` : ''}
            </div>
            <h1>{title}</h1>
            <div className={historyStyles.sub}>{subtitle}</div>
          </div>
        </Link>
        <div className={historyStyles.headerActions}>
          <NotificationBell />
          <button type="button" className={historyStyles.button} onClick={handleLogout}>
            Log out
          </button>
        </div>
      </header>
      <div className={shellStyles.layout}>
        <Sidebar />
        <main className={shellStyles.shellMain}>{children}</main>
      </div>
    </div>
  );
}
