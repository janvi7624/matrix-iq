'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter, usePathname } from 'next/navigation';
import { BRAND } from '@/lib/branding';
import { ModuleConfigRecord } from '@/lib/types';
import GlobalSearch from './GlobalSearch';
import NotificationBell from './NotificationBell';
import styles from './quotationHistory.module.css';

interface PortalHeaderProps {
  title: string;
  subtitle: string;
  showBackLink?: boolean;
}

export default function PortalHeader({ title, subtitle, showBackLink = true }: PortalHeaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [section, setSection] = useState<string | null>(null);

  // Breadcrumb section comes from the same /api/modules data Sidebar already
  // renders from — same source of truth, so "Section" here always matches
  // the section header the current page's tile sits under in the sidebar.
  useEffect(() => {
    fetch('/api/modules')
      .then((r) => (r.ok ? r.json() : []))
      .then((modules: ModuleConfigRecord[]) => {
        const match = modules.find((m) => pathname === m.href || pathname.startsWith(`${m.href}/`));
        setSection(match ? match.section : null);
      })
      .catch(() => setSection(null));
  }, [pathname]);

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => null);
    router.push('/login');
    router.refresh();
  }

  return (
    <header className={styles.header}>
      <Link href="/" className={styles.headerBrand} style={{ textDecoration: 'none', color: 'inherit' }}>
        <Image src="/NANTA.png" alt={`${BRAND.companyName} logo`} width={38} height={38} className={styles.headerLogo} unoptimized />
        <div>
          {section && <div className={styles.breadcrumb}>{section} <span>›</span> {title}</div>}
          <h1>{title}</h1>
          <div className={styles.sub}>{subtitle}</div>
        </div>
      </Link>
      <div className={styles.headerActions}>
        <GlobalSearch />
        <NotificationBell />
        {showBackLink && (
          <Link className={`${styles.button} ${styles.headerBackLink}`} href="/">
            &larr; <span className={styles.headerBackLinkLabel}>Back to Dashboard</span>
          </Link>
        )}
        <button type="button" className={styles.button} onClick={handleLogout}>
          Log out
        </button>
      </div>
    </header>
  );
}
