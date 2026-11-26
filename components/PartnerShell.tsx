'use client';

import Link from '@/components/ui/AppLink';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { BRAND } from '@/lib/branding';
import { BRAND_ASSETS } from '@/lib/brandAssets';
import { PARTNER_HOME } from '@/lib/partnerRoles';
import NotificationBell from './NotificationBell';
import SessionTimeoutWatcher from './SessionTimeoutWatcher';
import Sidebar from './Sidebar';
import CommonHeader, { CommonHeaderAction } from './ui/CommonHeader';
import CommonButton from './ui/CommonButton';
import { usePublishHeaderHeight } from './ui/usePublishHeaderHeight';
import historyStyles from './quotationHistory.module.css';
import headerStyles from './ui/commonHeader.module.css';
import shellStyles from './sidebar.module.css';
import { clearFetchCache } from '@/lib/fetchCached';

interface PartnerShellProps {
  title: string;
  subtitle: string;
  /** The partner company's name, shown so a multi-company user always knows whose portal they are in. */
  partnerName: string;
  partnerCode: string;
  headerActions?: CommonHeaderAction[];
  children: React.ReactNode;
}

/**
 * The portal's chrome — the partner-side counterpart to AppShell.
 *
 * Reuses AppShell's exact layout, CSS modules, Sidebar and the shared
 * CommonHeader so the portal is visibly the same product rather than a
 * bolted-on microsite. It is a separate component rather than a prop on
 * AppShell because of what it must LEAVE OUT, not what it adds: AppShell's
 * PortalHeader renders GlobalSearch (which searches internal records) and
 * links to '/', both of which a partner is blocked from. Like AppShell, the
 * header has no back button; portal sub-pages render PageBackButton
 * (rootRoute="/partner") in their own content.
 */
export default function PartnerShell({
  title,
  subtitle,
  partnerName,
  partnerCode,
  headerActions,
  children
}: PartnerShellProps) {
  // --mx-header-h for the sidebar and fill-the-screen pages, as PortalHeader does.
  const headerRef = usePublishHeaderHeight();
  const router = useRouter();

  async function handleLogout() {
    // A partner session must not leave its cached lists for the next one.
    clearFetchCache();
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => null);
    router.push('/login');
    router.refresh();
  }

  return (
    <div className={historyStyles.body}>
      <SessionTimeoutWatcher />
      <CommonHeader
        ref={headerRef}
        title={title}
        subtitle={subtitle}
        breadcrumb={['Partner Portal', `${partnerName}${partnerCode ? ` (${partnerCode})` : ''}`]}
        showBackButton={false}
        brand={
          <Link href={PARTNER_HOME} className={`${headerStyles.brand} ${headerStyles.brandCollapsible}`} aria-label="Partner portal home">
            <Image src={BRAND_ASSETS.logoWeb} alt={`${BRAND.companyName} logo`} width={38} height={38} className={historyStyles.headerLogo} loading="eager" unoptimized />
          </Link>
        }
        rightActions={headerActions}
        customActions={
          <>
            <NotificationBell />
            <CommonButton size="sm" variant="secondary" leadingIcon={<LogOut />} collapseOnPhone onClick={handleLogout}>
              Log out
            </CommonButton>
          </>
        }
      />
      <div className={shellStyles.layout}>
        <Sidebar />
        <main className={shellStyles.shellMain}>{children}</main>
      </div>
    </div>
  );
}
