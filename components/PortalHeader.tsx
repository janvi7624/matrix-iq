'use client';

import { useMemo } from 'react';
import Link from '@/components/ui/AppLink';
import Image from 'next/image';
import { useRouter, usePathname } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { BRAND } from '@/lib/branding';
import { BRAND_ASSETS } from '@/lib/brandAssets';
import { useShellData } from '@/lib/shellDataStore';
import GlobalSearch from './GlobalSearch';
import NotificationBell from './NotificationBell';
import CommonHeader, { CommonHeaderAction, CommonHeaderMenuItem } from './ui/CommonHeader';
import CommonButton from './ui/CommonButton';
import { usePublishHeaderHeight } from './ui/usePublishHeaderHeight';
import styles from './quotationHistory.module.css';
import headerStyles from './ui/commonHeader.module.css';
import { forgetCelebrationPopups } from '@/lib/celebrationPopupSeen';
import { clearFetchCache } from '@/lib/fetchCached';

export interface PortalHeaderProps {
  title: string;
  subtitle: string;
  /** Page-specific header actions, shown before the bell/log-out controls. */
  headerActions?: CommonHeaderAction[];
  headerMenu?: CommonHeaderMenuItem[];
}

// The internal application bar — a thin wrapper that feeds the app-level
// pieces (logo, module breadcrumb, global search, notifications, log out)
// into the shared CommonHeader, so every page gets the same
// [back][title][actions] layout from one component.
export default function PortalHeader({ title, subtitle, headerActions, headerMenu }: PortalHeaderProps) {
  const router = useRouter();
  const pathname = usePathname();

  // --mx-header-h / --mx-header-visible for the sidebar and fill-the-screen pages.
  const headerRef = usePublishHeaderHeight();

  // Breadcrumb section comes from the SAME module list the Sidebar renders
  // (lib/shellDataStore — fetched once per login), so "Section" here always
  // matches the section the current page sits under in the sidebar, and a
  // page change no longer re-requests /api/modules just for this label.
  const { sidebar } = useShellData();
  const section = useMemo(() => {
    const match = sidebar?.modules.find((m) => pathname === m.href || pathname.startsWith(`${m.href}/`));
    return match ? match.section : null;
  }, [sidebar, pathname]);

  async function handleLogout() {
    // So the birthday popup shows once on the NEXT login rather than being
    // suppressed for the rest of the day (lib/celebrationPopupSeen.ts).
    forgetCelebrationPopups();
    // See Sidebar: router.push is a client navigation and leaves module
    // state, the reference cache included, in place.
    clearFetchCache();
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => null);
    router.push('/login');
    router.refresh();
  }

  return (
    <CommonHeader
      ref={headerRef}
      title={title}
      subtitle={subtitle}
      breadcrumb={section ? [section, title] : undefined}
      // The main app bar never shows a back button — sub-pages render
      // components/ui/PageBackButton inside their own content instead.
      showBackButton={false}
      brand={
        <Link href="/" className={`${headerStyles.brand} ${headerStyles.brandCollapsible}`} aria-label={`${BRAND.appName} dashboard`}>
          <Image src={BRAND_ASSETS.logoWeb} alt={`${BRAND.companyName} logo`} width={38} height={38} className={styles.headerLogo} loading="eager" unoptimized />
        </Link>
      }
      showSearch
      search={<GlobalSearch />}
      rightActions={headerActions}
      menuItems={headerMenu}
      customActions={
        <>
          <NotificationBell />
          <CommonButton size="sm" variant="secondary" leadingIcon={<LogOut />} collapseOnPhone onClick={handleLogout}>
            Log out
          </CommonButton>
        </>
      }
    />
  );
}
