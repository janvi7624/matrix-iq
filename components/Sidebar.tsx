'use client';

import { useEffect, useLayoutEffect, useMemo, useState, useRef, useCallback } from 'react';
import Image from 'next/image';
import Link from '@/components/ui/AppLink';
import { useRouter, usePathname } from 'next/navigation';
import { ModuleConfigRecord, UserRole } from '@/lib/types';
import { BRAND } from '@/lib/branding';
import { BRAND_ASSETS } from '@/lib/brandAssets';
import { useModuleSections } from '@/lib/useModuleSections';
import { useCollapsibleSections } from '@/lib/useCollapsibleSections';
import { primarySectionForDepartment } from '@/lib/departmentCategoryMap';
import { sectionIconFor, resolveModuleIcon, QUICK_ACTION_ICON, CHROME_ICON } from '@/lib/icons';
import { TMS_ROLE_LABEL } from '@/lib/tmsLabels';
import { PARTNER_ROLE_LABEL, PARTNER_HOME, PARTNER_SECTION } from '@/lib/partnerRoles';
import { Search, Star, X, Sparkles, ChevronRight, Pin } from 'lucide-react';
import CommonButton from './ui/CommonButton';
import styles from './sidebar.module.css';
import { forgetCelebrationPopups } from '@/lib/celebrationPopupSeen';
import { clearFetchCache } from '@/lib/fetchCached';
import { loadQuickActions, loadSidebarData, setQuickActionKeys, useShellData } from '@/lib/shellDataStore';

interface Viewer {
  name: string;
  username: string;
  role: UserRole;
  department?: string;
  designation?: string;
  // External partner account — their home is the portal, not the internal
  // dashboard. Comes from /api/sidebar rather than being inferred from the
  // role key, so a mis-assigned role can't move someone's home link.
  isPartner?: boolean;
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
  ...TMS_ROLE_LABEL,
  ...PARTNER_ROLE_LABEL
};

// Quick Actions are each employee's own choice (GET/PUT
// /api/profile/quick-actions) — there is no longer a fixed set that everyone
// gets. Nothing is chosen until the person picks.
const DEFAULT_MAX_QUICK_ACTIONS = 6;
const EMPTY_BADGES: Record<string, number> = {};
const EMPTY_KEYS: string[] = [];
const EMPTY_MODULES: ModuleConfigRecord[] = [];

// Every page renders its own AppShell, so the Sidebar unmounts and remounts on
// each navigation. The menu DATA (modules, viewer, badges, quick actions) lives
// in lib/shellDataStore.ts — fetched once per login and reused, never
// re-requested on a page change. Only per-tab view state is kept here: the
// nav scroll position, and whether a Sidebar has already mounted (the first
// render must match the server HTML).
const sidebarCache: { mountedBefore: boolean; scrollTop: number } = { mountedBefore: false, scrollTop: 0 };

export default function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const shell = useShellData();
  // null = still loading (skeleton); [] = loaded but failed/empty.
  const modules: ModuleConfigRecord[] | null = shell.sidebar ? shell.sidebar.modules : shell.sidebarSettled ? EMPTY_MODULES : null;
  const viewer = (shell.sidebar?.viewer ?? null) as Viewer | null;
  const badges: Record<string, number> = shell.sidebar?.badges ?? EMPTY_BADGES;
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      // Only after the first page load (cache filled) — the first render must
      // match the server HTML.
      return sidebarCache.mountedBefore && window.localStorage.getItem('sidebar-collapsed') === 'true';
    } catch {
      return false;
    }
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [navHasMoreBelow, setNavHasMoreBelow] = useState(false);
  const navRef = useRef<HTMLElement | null>(null);
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

  const quickKeys = shell.quick?.keys ?? EMPTY_KEYS;
  const quickMax = shell.quick?.max ?? DEFAULT_MAX_QUICK_ACTIONS;
  const [editingQuick, setEditingQuick] = useState(false);
  const [quickDraft, setQuickDraft] = useState<string[]>([]);
  const [quickSaving, setQuickSaving] = useState(false);
  const [quickError, setQuickError] = useState('');

  // Once per login (lib/shellDataStore) — not on every page change.
  useEffect(() => {
    sidebarCache.mountedBefore = true;
    void loadQuickActions();
  }, []);

  function startEditQuick() {
    setQuickDraft(quickKeys);
    setQuickError('');
    setEditingQuick(true);
  }

  function toggleQuickDraft(key: string) {
    setQuickError('');
    setQuickDraft((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key);
      if (prev.length >= quickMax) {
        setQuickError(`You can pick up to ${quickMax}.`);
        return prev;
      }
      return [...prev, key];
    });
  }

  async function saveQuick() {
    setQuickSaving(true);
    setQuickError('');
    try {
      const res = await fetch('/api/profile/quick-actions', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ keys: quickDraft })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setQuickError(data?.error || 'Could not save — try again.');
        return;
      }
      setQuickActionKeys(Array.isArray(data?.keys) ? data.keys : quickDraft);
      setEditingQuick(false);
    } catch {
      setQuickError('Could not save — check your connection.');
    } finally {
      setQuickSaving(false);
    }
  }

  // Fetched once per login and shared by every page (lib/shellDataStore).
  // Deliberately NOT keyed on pathname: changing page must not re-request it.
  useEffect(() => {
    void loadSidebarData();
  }, []);

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

  // Where the "Dashboard" chrome link points. A partner's home is the portal
  // — linking them at '/' would work (proxy.ts redirects it) but would show a
  // visible bounce through a page they are never allowed to see.
  const homeHref = viewer?.isPartner ? PARTNER_HOME : '/';

  // The chrome "Dashboard" link above the nav already points at the viewer's
  // home, so a module tile with the same href renders a second, identical
  // entry — which is exactly what the Partner Portal's 'partner-dashboard'
  // tile did. Drop it from the nav list rather than from the registry: the
  // tile still has to exist for Module Manager and for the page guard's
  // isModuleAccessAllowed('partner-dashboard') check.
  //
  // Safe to compare against homeHref directly — modules and viewer are set
  // from the same response in one batch, so homeHref is already resolved
  // whenever modules is non-null.
  const navModules = useMemo(
    () => (modules ? modules.filter((m) => m.href !== homeHref) : modules),
    [modules, homeHref]
  );

  const isPartner = !!viewer?.isPartner;

  const ungroupedSections = useModuleSections(navModules);
  // Partners first see their own section. Section order is otherwise just the
  // order modules arrive in, which is alphabetical by section — so a partner
  // got Marketing at the top and their own Partner Portal group third.
  const sections = useMemo(() => {
    if (!isPartner) return ungroupedSections;
    return [...ungroupedSections].sort((a, b) => {
      if (a.label === PARTNER_SECTION) return -1;
      if (b.label === PARTNER_SECTION) return 1;
      return 0;
    });
  }, [isPartner, ungroupedSections]);

  const primarySection = primarySectionForDepartment(viewer?.department);
  const sectionLabels = useMemo(() => sections.map((s) => s.label), [sections]);
  const { isExpanded, toggle } = useCollapsibleSections(primarySection, {
    // A partner has no department, so primarySection is null and NOTHING
    // matched the pre-expand check — their sidebar rendered as four collapsed
    // headers with no nav link visible at all. Their whole nav is 7 items, so
    // it is shown open; the accordion is there to tame the internal app's
    // eleven sections and only gets in the way here.
    accordion: !isPartner,
    allLabels: sectionLabels,
    defaultExpanded: isPartner
  });

  // Signals whether the nav list has content below the fold — the accordion
  // can expand a section (e.g. a long Administration list) to exactly fill
  // the visible area with no visual cue that other sections still exist
  // below it. Re-checked on resize/section-toggle, not just on scroll, since
  // expanding a section changes scrollHeight without firing a scroll event.
  const updateNavFade = useCallback(() => {
    const el = navRef.current;
    if (!el) return;
    sidebarCache.scrollTop = el.scrollTop;
    setNavHasMoreBelow(el.scrollHeight - el.scrollTop - el.clientHeight > 4);
  }, []);

  // Put the menu back where it was scrolled to on the previous page.
  useLayoutEffect(() => {
    const el = navRef.current;
    if (el && sidebarCache.scrollTop) el.scrollTop = sidebarCache.scrollTop;
  }, [modules]);

  useEffect(() => {
    updateNavFade();
  }, [sections, isExpanded, collapsed, searchQuery, updateNavFade]);

  useEffect(() => {
    const el = navRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateNavFade);
    observer.observe(el);
    window.addEventListener('resize', updateNavFade);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateNavFade);
    };
  }, [updateNavFade]);

  const quickActions = useMemo(() => {
    const byKey = new Map((modules || []).map((m) => [m.key, m]));
    return quickKeys.map((key) => byKey.get(key)).filter((m): m is ModuleConfigRecord => !!m);
  }, [modules, quickKeys]);

  // What the picker offers: every module this person can actually open,
  // alphabetical so it is scannable.
  const quickChoices = useMemo(
    () => [...(modules || [])].sort((a, b) => a.label.localeCompare(b.label)),
    [modules]
  );

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
    // router.push below is a CLIENT-side navigation, so module state —
    // the cached staff and department lists included — survives it. One
    // browser can hold two sessions in sequence, and the second must not
    // read the first's lists.
    clearFetchCache();
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
            <Image src={BRAND_ASSETS.iconMark} alt={`${BRAND.companyName} logo`} width={34} height={34} className={styles.brandLogo} loading="eager" unoptimized />
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

        <nav className={styles.nav} ref={navRef} onScroll={updateNavFade}>
          {/* Main Dashboard Link */}
          {!searchQuery && (
            <Link href={homeHref} className={`${styles.link} ${isActive(homeHref) ? styles.linkActive : ''}`} data-tooltip="Dashboard">
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
        {navHasMoreBelow && !collapsed && <div className={styles.navFade} aria-hidden="true" />}

        {/* Quick Actions (only when not collapsed and not searching) */}
        {!searchQuery && modules && modules.length > 0 && (
          <div className={styles.quickActions}>
            <div className={styles.quickActionsHeader}>
              <div className={styles.quickActionsLabel}>Quick Actions</div>
              {!editingQuick && quickActions.length > 0 && (
                <button type="button" className={styles.quickActionsEdit} onClick={startEditQuick}>
                  Edit
                </button>
              )}
            </div>

            {editingQuick ? (
              <div className={styles.quickPicker}>
                <div className={styles.quickPickerHint}>
                  Pick up to {quickMax} shortcuts — only you see these. ({quickDraft.length}/{quickMax})
                </div>
                <div className={styles.quickPickerList}>
                  {quickChoices.map((m) => (
                    <label key={m.key} className={styles.quickPickerItem}>
                      <input
                        type="checkbox"
                        checked={quickDraft.includes(m.key)}
                        onChange={() => toggleQuickDraft(m.key)}
                      />
                      <span>{m.label}</span>
                    </label>
                  ))}
                </div>
                {quickError && <div className={styles.quickPickerError}>{quickError}</div>}
                <div className={styles.quickPickerActions}>
                  <CommonButton size="sm" onClick={() => setEditingQuick(false)} disabled={quickSaving}>
                    Cancel
                  </CommonButton>
                  <CommonButton variant="primary" size="sm" onClick={saveQuick} loading={quickSaving} loadingLabel="Saving…">
                    Save
                  </CommonButton>
                </div>
              </div>
            ) : quickActions.length > 0 ? (
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
            ) : (
              <button type="button" className={styles.quickActionsEmpty} onClick={startEditQuick}>
                + Add your own shortcuts
              </button>
            )}
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
                {viewer ? (viewer.designation || ROLE_LABEL[viewer.role]) : ''}
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

