'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter, usePathname } from 'next/navigation';
import { BRAND } from '@/lib/branding';
import { ModuleConfigRecord } from '@/lib/types';
import GlobalSearch from './GlobalSearch';
import NotificationBell from './NotificationBell';
import styles from './quotationHistory.module.css';
import { forgetCelebrationPopups } from '@/lib/celebrationPopupSeen';
import { clearFetchCache } from '@/lib/fetchCached';

interface PortalHeaderProps {
  title: string;
  subtitle: string;
  showBackLink?: boolean;
}

export default function PortalHeader({ title, subtitle, showBackLink = true }: PortalHeaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [section, setSection] = useState<string | null>(null);

  // Publishes how much of this bar is still on screen, as
  // --mx-header-visible, so the sidebar beside it can be exactly "the rest
  // of the screen" at every scroll position. The header scrolls away like
  // any other element, so that number falls from its full height to 0 over
  // the first screenful and the sidebar grows to meet it.
  //
  // Measured rather than hard-coded: the header has flex-wrap and becomes
  // two rows on a narrow window, so a constant would clip the sidebar again
  // at exactly the widths where the space matters most. ResizeObserver
  // rather than a resize listener catches a wrap caused by a longer page
  // title too, not only a window resize.
  const headerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    let frame = 0;
    let lastHeight = -1;
    let lastVisible = -1;
    const publish = () => {
      frame = 0;
      const height = Math.round(el.getBoundingClientRect().height);
      if (height !== lastHeight) {
        lastHeight = height;
        document.documentElement.style.setProperty('--mx-header-h', `${height}px`);
      }
      const visible = Math.max(0, height - Math.round(window.scrollY));
      // Only written when it actually changes: past the first screenful this
      // is 0 on every scroll event, and rewriting a custom property on the
      // root invalidates style for the whole document each time.
      if (visible !== lastVisible) {
        lastVisible = visible;
        document.documentElement.style.setProperty('--mx-header-visible', `${visible}px`);
      }
    };
    // Coalesced to one write per frame — scroll fires far faster than paint.
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(publish);
    };
    publish();
    const observer = new ResizeObserver(schedule);
    observer.observe(el);
    window.addEventListener('scroll', schedule, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

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
    <header ref={headerRef} className={styles.header}>
      <Link href="/" className={styles.headerBrand}>
        <Image src={BRAND.logoWeb} alt={`${BRAND.companyName} logo`} width={38} height={38} className={styles.headerLogo} unoptimized />
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
