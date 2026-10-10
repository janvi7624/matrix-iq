'use client';

import { useEffect, useMemo, useState, useRef } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { ModuleConfigRecord, UserRole } from '@/lib/types';
import { BRAND } from '@/lib/branding';
import { useModuleSections } from '@/lib/useModuleSections';
import { useCollapsibleSections } from '@/lib/useCollapsibleSections';
import { primarySectionForDepartment } from '@/lib/departmentCategoryMap';
import { sectionIconFor, resolveModuleIcon, QUICK_ACTION_ICON, CHROME_ICON } from '@/lib/icons';
import { TMS_ROLE_LABEL } from '@/lib/tmsLabels';
import { Search, Star, X, Sparkles, ChevronRight, Pin } from 'lucide-react';
import styles from './sidebar.module.css';
import { forgetCelebrationPopups } from '@/lib/celebrationPopupSeen';

interface Viewer {
  name: string;
  username: string;
  role: UserRole;
  department?: string;
}

const ROLE_LABEL: Record<UserRole, string> = {
  superadmin: 'Super Admin',
  admin: 'Admin',
  manager: 'Manager',
  engineer: 'Engineer',
  backoffice: 'Back Office',
  user: 'Sales',
  marketing: 'Marketing',
  accounts: 'Accounts',
  hr: 'HR',
  ...TMS_ROLE_LABEL
};

const QUICK_ACTION_KEYS = ['quotation', 'site-visits', 'demo-schedule', 'projects'];

export default function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const [modules, setModules] = useState<ModuleConfigRecord[] | null>(null);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [badges, setBadges] = useState<Record<string, number>>({});
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [pinnedKeys, setPinnedKeys] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const saved = localStorage.getItem('matrix_sidebar_pinned');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/sidebar')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setModules(data.modules ?? []);
        setViewer(data.viewer ?? null);
        setBadges(data.badges ?? {});
      })
      .catch(() => {
        if (!cancelled) setModules((prev) => prev ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

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

  function togglePin(e: React.MouseEvent, key: string) {
    e.preventDefault();
    e.stopPropagation();
    setPinnedKeys((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      try {
        localStorage.setItem('matrix_sidebar_pinned', JSON.stringify(next));
      } catch {
        // storage ignored
      }
      return next;
    });
  }

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const sections = useModuleSections(modules);
  const primarySection = primarySectionForDepartment(viewer?.department);
  const sectionLabels = useMemo(() => sections.map((s) => s.label), [sections]);
  const { isExpanded, toggle } = useCollapsibleSections(primarySection, { accordion: true, allLabels: sectionLabels });

  const quickActions = useMemo(() => {
    const byKey = new Map((modules || []).map((m) => [m.key, m]));
    return QUICK_ACTION_KEYS.map((key) => byKey.get(key)).filter((m): m is ModuleConfigRecord => !!m);
  }, [modules]);

  // All tiles flat map
  const allTiles = useMemo(() => {
    const map = new Map<string, { id: string; key: string; label: string; href: string; icon: string; category: string }>();
    for (const sec of sections) {
      for (const t of sec.tiles) {
        map.set(t.key, { ...t, category: sec.label });
      }
    }
    return map;
  }, [sections]);

  // Pinned items
  const pinnedTiles = useMemo(() => {
    return pinnedKeys
      .map((key) => allTiles.get(key))
      .filter((t): t is { id: string; key: string; label: string; href: string; icon: string; category: string } => !!t);
  }, [pinnedKeys, allTiles]);

  // Filtered sections when searching
  const filteredSections = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return null;
    return sections
      .map((sec) => {
        const matchingTiles = sec.tiles.filter(
          (t) => t.label.toLowerCase().includes(query) || sec.label.toLowerCase().includes(query)
        );
        return {
          ...sec,
          tiles: matchingTiles
        };
      })
      .filter((sec) => sec.tiles.length > 0);
  }, [sections, searchQuery]);

  function isActive(href: string): boolean {
    if (href === '/') return pathname === '/';
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  async function handleLogout() {
    forgetCelebrationPopups();
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
        {/* Brand Header */}
        <div className={styles.brand}>
          <div className={styles.brandLogoWrapper}>
            <Image src={BRAND.iconMark} alt={`${BRAND.companyName} logo`} width={34} height={34} className={styles.brandLogo} unoptimized />
          </div>
          <div className={styles.brandText}>
            <div className={styles.brandNameRow}>
              <span className={styles.brandName}>{BRAND.appName}</span>
              <span className={styles.brandVersion}>v{BRAND.version}</span>
            </div>
            <div className={styles.brandTagline}>{BRAND.tagline}</div>
          </div>
        </div>

        {/* Floating collapse toggle */}
        <button
          type="button"
          className={styles.collapseBtn}
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <CHROME_ICON.collapseLeft size={13} />
        </button>

        {/* Search / Filter in sidebar (when expanded) */}
        {!collapsed && (
          <div className={styles.searchWrapper}>
            <div className={styles.searchBox}>
              <Search size={13} className={styles.searchIcon} />
              <input
                ref={searchInputRef}
                type="text"
                className={styles.searchInput}
                placeholder="Quick jump..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Filter navigation menu"
              />
              {searchQuery && (
                <button
                  type="button"
                  className={styles.searchClearBtn}
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear filter"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>
        )}

        <nav className={styles.nav}>
          {/* Main Dashboard Link */}
          {!searchQuery && (
            <Link href="/" className={`${styles.link} ${isActive('/') ? styles.linkActive : ''}`} data-tooltip="Dashboard">
              <span className={styles.linkIcon}><CHROME_ICON.dashboard size={16} /></span>
              <span className={styles.linkLabel}>Dashboard</span>
            </Link>
          )}

          {/* Pinned / Favorites Section */}
          {!searchQuery && pinnedTiles.length > 0 && (
            <div className={styles.pinnedSection}>
              {!collapsed && (
                <div className={styles.pinnedHeader}>
                  <Star size={11} className={styles.pinnedHeaderIcon} />
                  <span>Pinned Shortcuts</span>
                </div>
              )}
              {pinnedTiles.map((tile) => {
                const TileIcon = resolveModuleIcon(tile.icon);
                return (
                  <Link
                    key={`pinned-${tile.id}`}
                    href={tile.href}
                    className={`${styles.link} ${styles.linkPinned} ${isActive(tile.href) ? styles.linkActive : ''}`}
                    data-tooltip={`★ ${tile.label}`}
                  >
                    <span className={styles.linkIcon}>{TileIcon ? <TileIcon size={16} /> : tile.icon}</span>
                    <span className={styles.linkLabel}>{tile.label}</span>
                    {!!badges[tile.key] && <span className={styles.badge}>{badges[tile.key]}</span>}
                    <button
                      type="button"
                      className={styles.pinToggleBtn}
                      onClick={(e) => togglePin(e, tile.key)}
                      title="Unpin from shortcuts"
                    >
                      <Star size={11} fill="currentColor" />
                    </button>
                  </Link>
                );
              })}
            </div>
          )}

          {/* Search Result Mode */}
          {filteredSections ? (
            <div className={styles.searchResultsContainer}>
              <div className={styles.searchResultsCount}>
                Found {filteredSections.reduce((acc, s) => acc + s.tiles.length, 0)} match(es)
              </div>
              {filteredSections.map((section) => (
                <div key={`search-${section.label}`} className={styles.searchSectionGroup}>
                  <div className={styles.searchSectionTitle}>{section.label}</div>
                  {section.tiles.map((tile) => {
                    const TileIcon = resolveModuleIcon(tile.icon);
                    return (
                      <Link
                        key={tile.id}
                        href={tile.href}
                        className={`${styles.link} ${isActive(tile.href) ? styles.linkActive : ''}`}
                      >
                        <span className={styles.linkIcon}>{TileIcon ? <TileIcon size={16} /> : tile.icon}</span>
                        <span className={styles.linkLabel}>{tile.label}</span>
                        {!!badges[tile.key] && <span className={styles.badge}>{badges[tile.key]}</span>}
                      </Link>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : (
            /* Normal Categorized Accordion Sections */
            sections.map((section) => {
              const SectionIcon = sectionIconFor(section.label);
              const isSectionOpen = isExpanded(section.label);
              return (
                <div key={section.label} className={styles.sectionContainer}>
                  <button
                    type="button"
                    className={styles.sectionLabel}
                    aria-expanded={isSectionOpen}
                    onClick={() => toggle(section.label)}
                  >
                    <span className={styles.sectionLabelMain}>
                      <span className={styles.sectionIcon}><SectionIcon size={13} /></span>
                      <span className={styles.sectionLabelText}>{section.label}</span>
                      <span className={styles.sectionCountPill}>{section.tiles.length}</span>
                    </span>
                    <span className={styles.sectionChevron}>
                      <ChevronRight size={13} />
                    </span>
                  </button>

                  {(collapsed || isSectionOpen) && (
                    <div className={styles.sectionBody}>
                      {section.tiles.map((tile) => {
                        const TileIcon = resolveModuleIcon(tile.icon);
                        const isPinned = pinnedKeys.includes(tile.key);
                        return (
                          <div key={tile.id} className={styles.linkWrapper}>
                            <Link
                              href={tile.href}
                              className={`${styles.link} ${isActive(tile.href) ? styles.linkActive : ''}`}
                              data-tooltip={tile.label}
                            >
                              <span className={styles.linkIcon}>{TileIcon ? <TileIcon size={16} /> : tile.icon}</span>
                              <span className={styles.linkLabel}>{tile.label}</span>
                              {!!badges[tile.key] && <span className={styles.badge}>{badges[tile.key]}</span>}
                            </Link>
                            {!collapsed && (
                              <button
                                type="button"
                                className={`${styles.pinActionBtn} ${isPinned ? styles.pinActionBtnActive : ''}`}
                                onClick={(e) => togglePin(e, tile.key)}
                                title={isPinned ? 'Unpin from top' : 'Pin to top shortcuts'}
                                aria-label={isPinned ? 'Unpin' : 'Pin'}
                              >
                                <Pin size={11} />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </nav>

        {/* Quick Actions (only when not collapsed and not searching) */}
        {!searchQuery && quickActions.length > 0 && (
          <div className={styles.quickActions}>
            <div className={styles.quickActionsLabel}>Quick Actions</div>
            <div className={styles.quickActionsGrid}>
              {quickActions.map((m) => {
                const QuickIcon = QUICK_ACTION_ICON[m.key] || resolveModuleIcon(m.icon);
                return (
                  <Link key={m.id} href={m.href} className={styles.quickActionBtn}>
                    <span className={styles.quickActionIcon}>{QuickIcon ? <QuickIcon size={14} /> : m.icon}</span>
                    <span>{m.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {/* User Profile & Auth Footer */}
        <div className={styles.profile}>
          <Link href="/profile" className={styles.profileLink} title="My Profile & Settings">
            <div className={styles.avatarWrapper}>
              <div className={styles.avatar}>{initials}</div>
              <span className={styles.avatarStatus} title="Active Online" />
            </div>
            <div className={styles.profileInfo}>
              <div className={styles.profileName}>{viewer?.name || '…'}</div>
              <div className={styles.profileMeta}>
                {viewer ? ROLE_LABEL[viewer.role] : ''}
                {viewer?.department ? ` · ${viewer.department}` : ''}
              </div>
            </div>
          </Link>
          <button type="button" className={styles.logoutBtn} onClick={handleLogout} title="Log out" aria-label="Log out">
            <CHROME_ICON.logout size={15} />
          </button>
        </div>
      </aside>
    </>
  );
}

