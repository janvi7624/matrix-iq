'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { ModuleConfigRecord, UserRole } from '@/lib/types';
import { BRAND } from '@/lib/branding';
import { useModuleSections } from '@/lib/useModuleSections';
import { useCollapsibleSections } from '@/lib/useCollapsibleSections';
import { primarySectionForDepartment } from '@/lib/departmentCategoryMap';
import { sectionIconFor, resolveModuleIcon, QUICK_ACTION_ICON, CHROME_ICON } from '@/lib/icons';
import styles from './sidebar.module.css';

interface Viewer {
  name: string;
  role: UserRole;
  department?: string;
}

const ROLE_LABEL: Record<UserRole, string> = { superadmin: 'Super Admin', admin: 'Admin', manager: 'Manager', engineer: 'Engineer', backoffice: 'Back Office', user: 'Sales', marketing: 'Marketing', accounts: 'Accounts', hr: 'HR' };

// Curated shortcuts for the Quick Actions panel — a subset of the full nav,
// matched by module key so it stays role-authorized "for free" (only shows
// entries the /api/modules response actually contains for this viewer).
const QUICK_ACTION_KEYS = ['quotation', 'site-visits', 'demo-schedule', 'projects'];

// Data-driven from the same /api/modules endpoint the Dashboard tile grid
// uses (lib/moduleConfigStore.ts's listVisibleModules) — already filtered
// server-side to modules that are enabled AND visible to the caller's role,
// so "role authorized only" needs no extra logic here.
export default function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const [modules, setModules] = useState<ModuleConfigRecord[] | null>(null);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [badges, setBadges] = useState<Record<string, number>>({});
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // One round trip instead of what used to be /api/auth/me followed
  // (sequentially, only once that resolved) by up to 4 more badge-count
  // fetches, plus a separate /api/modules call — see app/api/sidebar/
  // route.ts, which resolves the viewer once and fans everything out in
  // parallel server-side. Runs on every page (Sidebar is in AppShell), so
  // this compounds across every navigation, not just first load.
  useEffect(() => {
    fetch('/api/sidebar')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        setModules(data.modules ?? []);
        setViewer(data.viewer ?? null);
        setBadges(data.badges ?? {});
      })
      .catch(() => {
        setModules([]);
        setViewer(null);
        setBadges({});
      });
  }, []);

  // Explicit user choice wins; otherwise default to a compact rail on
  // tablet-width screens and fully expanded everywhere else — re-evaluated
  // on resize (debounced) as well as on mount, so dragging the window across
  // the 768/1080 boundary (or rotating a tablet) doesn't leave the rail
  // stuck at whatever it computed on first paint. Never overrides an
  // explicit toggle (toggleCollapsed() below persists one to localStorage).
  useEffect(() => {
    function applyDefaultIfNoExplicitChoice() {
      if (window.localStorage.getItem('sidebar-collapsed') !== null) return;
      setCollapsed(window.innerWidth > 768 && window.innerWidth <= 1080);
    }
    applyDefaultIfNoExplicitChoice();

    let resizeTimer: ReturnType<typeof setTimeout>;
    function onResize() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(applyDefaultIfNoExplicitChoice, 150);
    }
    window.addEventListener('resize', onResize);
    return () => {
      clearTimeout(resizeTimer);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem('sidebar-collapsed', String(next));
      return next;
    });
  }

  // Closes the mobile drawer automatically after navigating to a new page.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const sections = useModuleSections(modules);
  const primarySection = primarySectionForDepartment(viewer?.department);
  const { isExpanded, toggle } = useCollapsibleSections(primarySection);

  const quickActions = useMemo(() => {
    const byKey = new Map((modules || []).map((m) => [m.key, m]));
    return QUICK_ACTION_KEYS.map((key) => byKey.get(key)).filter((m): m is ModuleConfigRecord => !!m);
  }, [modules]);

  function isActive(href: string): boolean {
    if (href === '/') return pathname === '/';
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => null);
    router.push('/login');
    router.refresh();
  }

  const initials = viewer?.name ? viewer.name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') : '?';

  return (
    <>
      <button type="button" className={styles.toggleBtn} onClick={() => setOpen((v) => !v)} aria-label="Toggle navigation menu">
        {open ? <CHROME_ICON.menuClose size={18} /> : <CHROME_ICON.menuOpen size={18} />}
      </button>
      {open && <div className={styles.overlay} onClick={() => setOpen(false)} />}
      <aside className={`${styles.sidebar} ${open ? styles.sidebarOpen : ''} ${collapsed ? styles.sidebarCollapsed : ''}`}>
        <div className={styles.brand}>
          <Image src={BRAND.logo} alt={`${BRAND.companyName} logo`} width={32} height={32} className={styles.brandLogo} unoptimized />
          <div className={styles.brandText}>
            <div className={styles.brandName}>{BRAND.appName}</div>
            <div className={styles.brandMeta}>v{BRAND.version}</div>
          </div>
        </div>
        <button
          type="button"
          className={styles.collapseBtn}
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <CHROME_ICON.collapseLeft size={14} />
        </button>

        <nav className={styles.nav}>
          <Link href="/" className={`${styles.link} ${isActive('/') ? styles.linkActive : ''}`} data-tooltip="Dashboard">
            <span className={styles.linkIcon}><CHROME_ICON.dashboard size={16} /></span>
            <span className={styles.linkLabel}>Dashboard</span>
          </Link>
          {sections.map((section) => {
            const SectionIcon = sectionIconFor(section.label);
            return (
              <div key={section.label}>
                <button
                  type="button"
                  className={styles.sectionLabel}
                  aria-expanded={isExpanded(section.label)}
                  onClick={() => toggle(section.label)}
                >
                  <span className={styles.sectionLabelMain}>
                    <span className={styles.sectionIcon}><SectionIcon size={13} /></span>
                    <span className={styles.sectionLabelText}>{section.label}</span>
                  </span>
                  <span className={styles.sectionChevron}>›</span>
                </button>
                {(collapsed || isExpanded(section.label)) &&
                  section.tiles.map((tile) => {
                    const TileIcon = resolveModuleIcon(tile.icon);
                    return (
                      <Link key={tile.id} href={tile.href} className={`${styles.link} ${isActive(tile.href) ? styles.linkActive : ''}`} data-tooltip={tile.label}>
                        <span className={styles.linkIcon}>{TileIcon ? <TileIcon size={16} /> : tile.icon}</span>
                        <span className={styles.linkLabel}>{tile.label}</span>
                        {!!badges[tile.key] && <span className={styles.badge}>{badges[tile.key]}</span>}
                      </Link>
                    );
                  })}
              </div>
            );
          })}
        </nav>

        {quickActions.length > 0 && (
          <div className={styles.quickActions}>
            <div className={styles.quickActionsLabel}>Quick Actions</div>
            <div className={styles.quickActionsGrid}>
              {quickActions.map((m) => {
                const QuickIcon = QUICK_ACTION_ICON[m.key] || resolveModuleIcon(m.icon);
                return (
                  <Link key={m.id} href={m.href} className={styles.quickActionBtn}>
                    <span className={styles.quickActionIcon}>{QuickIcon ? <QuickIcon size={15} /> : m.icon}</span>
                    {m.label}
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        <div className={styles.profile}>
          <Link href="/profile" className={styles.profileLink} title="My Profile">
            <div className={styles.avatar}>{initials}</div>
            <div className={styles.profileInfo}>
              <div className={styles.profileName}>{viewer?.name || '…'}</div>
              <div className={styles.profileMeta}>{viewer ? ROLE_LABEL[viewer.role] : ''}{viewer?.department ? ` · ${viewer.department}` : ''}</div>
            </div>
          </Link>
          <button type="button" className={styles.logoutBtn} onClick={handleLogout} title="Log out" aria-label="Log out"><CHROME_ICON.logout size={15} /></button>
        </div>
      </aside>
    </>
  );
}
