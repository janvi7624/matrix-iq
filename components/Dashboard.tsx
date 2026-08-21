'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { DemoScheduleRecord, ModuleConfigRecord, ProjectHandoverRecord, ProjectRecord, QuotationRecord, UserRole } from '@/lib/types';
import { TechnicalRosterEntry } from '@/lib/technicalRoster';
import { STAGE_LABEL as PROJECT_STAGE_LABEL } from '@/lib/projectStages';
import { formatMoney } from '@/lib/format';
import AppShell from './AppShell';
import { BRAND } from '@/lib/branding';
import { useModuleSections } from '@/lib/useModuleSections';
import { useCollapsibleSections } from '@/lib/useCollapsibleSections';
import { primarySectionForDepartment } from '@/lib/departmentCategoryMap';
import { sectionIconFor, ATTENTION_ICON, ALL_CAUGHT_UP_ICON, ANALYTICS_ICON } from '@/lib/icons';
import styles from './dashboard.module.css';

interface DashboardProps {
  currentUser: { id: string; username: string; name: string; role: UserRole; department?: string };
}

type ManagersByDepartment = Record<string, { id: string; username: string; name: string }[]>;

// The full KPI grids live at /analytics (components/AnalyticsView.tsx) — the
// Dashboard only pulls in the subset it needs for the attention panel and,
// for Manager+, the Team Overview strip below it.
interface Kpis {
  pendingApprovals: number;
  totalProjects: number;
  activeProjects: number;
  conversionRate: number;
}

interface BackOfficeKpis {
  pendingDc: number;
  pendingVerification: number;
}

interface QuotationStatsSummary {
  total: number;
  sent: number;
  approved: number;
  rejected: number;
}

interface AttentionItem {
  key: string;
  label: string;
  count: number;
  href: string;
  tone: 'urgent' | 'info';
}

function timeOfDayGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function Dashboard({ currentUser }: DashboardProps) {
  const [followUpCount, setFollowUpCount] = useState<number | null>(null);
  const [reminderCount, setReminderCount] = useState<number | null>(null);
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [backOfficeKpis, setBackOfficeKpis] = useState<BackOfficeKpis | null>(null);
  const [modules, setModules] = useState<ModuleConfigRecord[] | null>(null);
  const [unattendedLeads, setUnattendedLeads] = useState<number | null>(null);
  const [marketingStats, setMarketingStats] = useState<{ isReviewer: boolean; awaitingReview?: number; myOpenCount?: number } | null>(null);
  const [allProjects, setAllProjects] = useState<ProjectRecord[] | null>(null);
  const [recentQuotations, setRecentQuotations] = useState<QuotationRecord[] | null>(null);
  const [quotationStats, setQuotationStats] = useState<QuotationStatsSummary | null>(null);
  const [demos, setDemos] = useState<DemoScheduleRecord[] | null>(null);
  const [managersByDepartment, setManagersByDepartment] = useState<ManagersByDepartment>({});
  const [technicalRoster, setTechnicalRoster] = useState<TechnicalRosterEntry[]>([]);
  const [pendingHandovers, setPendingHandovers] = useState<ProjectHandoverRecord[]>([]);

  const isPrivileged = currentUser.role === 'admin' || currentUser.role === 'superadmin' || currentUser.role === 'manager';
  const isBackOffice = currentUser.role === 'backoffice' || isPrivileged;
  const isManagerTier = currentUser.role === 'manager' || currentUser.role === 'admin' || currentUser.role === 'superadmin';

  // Tiles are entirely config-driven now (Module Manager, /admin/modules) —
  // enable/disable/rename/reorder/re-section a module without a code change.
  const sections = useModuleSections(modules);

  // The viewer's department's own category surfaces first, everything else
  // keeps its existing relative order after it — reorder, not hide.
  const primarySection = primarySectionForDepartment(currentUser.department);
  const orderedSections = useMemo(() => {
    if (!primarySection) return sections;
    const idx = sections.findIndex((s) => s.label === primarySection);
    if (idx <= 0) return sections;
    return [sections[idx], ...sections.slice(0, idx), ...sections.slice(idx + 1)];
  }, [sections, primarySection]);
  const { isExpanded, toggle } = useCollapsibleSections(primarySection);

  // One round trip instead of what used to be up to 13 separate fetches
  // (modules, projects/kpis, backoffice/kpis, admin/quotations, site-visits,
  // leads/stats, marketing-requests/stats, projects, demo-schedule,
  // departments/managers, technical-roster, quotations/mine, quotations/
  // stats) — see app/api/dashboard/route.ts, which resolves the viewer once
  // and fans out server-side instead of once per client request. Role-gated
  // fields (followUpCount, backOfficeKpis, quotationStats) still come back
  // null for a viewer they don't apply to, same as before.
  useEffect(() => {
    fetch('/api/dashboard')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        setModules(data.modules ?? []);
        setKpis(data.kpis ?? null);
        setBackOfficeKpis(data.backOfficeKpis ?? null);
        setFollowUpCount(data.followUpCount ?? null);
        setReminderCount(data.reminderCount ?? null);
        setUnattendedLeads(data.unattendedLeads ?? null);
        setMarketingStats(data.marketingStats ?? null);
        setAllProjects(data.allProjects ?? []);
        setDemos(data.demos ?? []);
        setManagersByDepartment(data.managersByDepartment ?? {});
        setTechnicalRoster(data.technicalRoster ?? []);
        setRecentQuotations(data.recentQuotations ?? []);
        setQuotationStats(data.quotationStats ?? null);
        setPendingHandovers(data.pendingHandovers ?? []);
      })
      .catch(() => {
        setModules([]);
        setKpis(null);
        setBackOfficeKpis(null);
        setFollowUpCount(null);
        setReminderCount(null);
        setUnattendedLeads(null);
        setMarketingStats(null);
        setAllProjects([]);
        setDemos([]);
        setManagersByDepartment({});
        setTechnicalRoster([]);
        setRecentQuotations([]);
        setQuotationStats(null);
      });
  }, []);

  const recentProjects = useMemo(() => (allProjects ? [...allProjects].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)).slice(0, 5) : null), [allProjects]);

  // Departments the viewer manages — drives "Demos awaiting your approval"
  // and is purely a lib/departmentStore.ts Department.managerIds
  // relationship, independent of login role.
  const managedDepartments = useMemo(
    () => Object.entries(managersByDepartment).filter(([, managers]) => managers.some((m) => m.id === currentUser.id)).map(([name]) => name),
    [managersByDepartment, currentUser.id]
  );

  const myAssignedProjects = useMemo(() => (allProjects || []).filter((p) => p.assigned_technical_person_id === currentUser.id), [allProjects, currentUser.id]);
  const myAssignedDemos = useMemo(() => (demos || []).filter((d) => d.assigned_technical_person_id === currentUser.id), [demos, currentUser.id]);
  const demosAwaitingMyConfirmation = useMemo(() => myAssignedDemos.filter((d) => d.status === 'pending_technical'), [myAssignedDemos]);
  const rosterById = useMemo(() => new Map(technicalRoster.map((p) => [p.id, p])), [technicalRoster]);
  const demosAwaitingMyApproval = useMemo(() => {
    if (!managedDepartments.length) return [];
    return (demos || []).filter((d) => {
      if (d.status !== 'pending_manager') return false;
      const assigneeDepartment = rosterById.get(d.assigned_technical_person_id)?.department;
      return !!assigneeDepartment && managedDepartments.includes(assigneeDepartment);
    });
  }, [demos, managedDepartments, rosterById]);

  // One unified "what needs me right now" list instead of a stack of
  // identically-styled banners — built from exactly the same data the old
  // banners used, just prioritized (urgent first) and given a positive
  // empty state instead of silently rendering nothing.
  const attentionItems = useMemo<AttentionItem[]>(() => {
    const items: AttentionItem[] = [];
    if (isPrivileged && followUpCount) {
      items.push({ key: 'followup', label: `Quotation${followUpCount === 1 ? '' : 's'} needing a follow-up`, count: followUpCount, href: '/quotation-history', tone: 'urgent' });
    }
    if ((currentUser.role === 'technical' || isManagerTier) && kpis?.pendingApprovals) {
      items.push({ key: 'demo-approvals', label: `Demo request${kpis.pendingApprovals === 1 ? '' : 's'} awaiting approval`, count: kpis.pendingApprovals, href: '/demo-schedule', tone: 'urgent' });
    }
    if (isBackOffice && backOfficeKpis?.pendingDc) {
      items.push({ key: 'dc', label: `Demo${backOfficeKpis.pendingDc === 1 ? '' : 's'} awaiting a Delivery Challan`, count: backOfficeKpis.pendingDc, href: '/backoffice', tone: 'urgent' });
    }
    if (isBackOffice && backOfficeKpis?.pendingVerification) {
      items.push({ key: 'dc-verify', label: `DC${backOfficeKpis.pendingVerification === 1 ? '' : 's'} awaiting material return verification`, count: backOfficeKpis.pendingVerification, href: '/backoffice', tone: 'urgent' });
    }
    if (unattendedLeads) {
      items.push({ key: 'leads', label: 'Unattended leads', count: unattendedLeads, href: '/leads?filter=unattended', tone: 'urgent' });
    }
    if (marketingStats?.isReviewer && marketingStats.awaitingReview) {
      items.push({ key: 'marketing', label: 'Marketing tickets awaiting review', count: marketingStats.awaitingReview, href: '/marketing-requests?filter=submitted', tone: 'info' });
    }
    if (reminderCount) {
      items.push({ key: 'sitevisit', label: `Site visit reminder${reminderCount === 1 ? '' : 's'} due`, count: reminderCount, href: '/site-visits?focus=open', tone: 'info' });
    }
    if (demosAwaitingMyConfirmation.length) {
      items.push({
        key: 'my-demo-confirm',
        label: `Demo${demosAwaitingMyConfirmation.length === 1 ? '' : 's'} awaiting your confirmation`,
        count: demosAwaitingMyConfirmation.length,
        href: '/demo-schedule',
        tone: 'urgent'
      });
    }
    if (demosAwaitingMyApproval.length) {
      items.push({
        key: 'my-demo-approve',
        label: `Demo${demosAwaitingMyApproval.length === 1 ? '' : 's'} awaiting your approval`,
        count: demosAwaitingMyApproval.length,
        href: '/demo-schedule',
        tone: 'urgent'
      });
    }
    if (pendingHandovers.length) {
      items.push({
        key: 'handover',
        label: `Project handover request${pendingHandovers.length === 1 ? '' : 's'} awaiting your response`,
        count: pendingHandovers.length,
        href: `/projects/${pendingHandovers[0].project_id}`,
        tone: 'urgent'
      });
    }
    return items;
  }, [
    isPrivileged,
    followUpCount,
    currentUser.role,
    isManagerTier,
    kpis,
    isBackOffice,
    backOfficeKpis,
    unattendedLeads,
    marketingStats,
    reminderCount,
    demosAwaitingMyConfirmation,
    demosAwaitingMyApproval,
    pendingHandovers
  ]);

  // Only declare "you're all caught up" once every signal this role
  // actually receives has resolved — otherwise a still-loading dashboard
  // would flash a false all-clear before the real counts arrive.
  const attentionLoading =
    reminderCount === null ||
    unattendedLeads === null ||
    kpis === null ||
    marketingStats === null ||
    (isPrivileged && followUpCount === null) ||
    (isBackOffice && backOfficeKpis === null);

  return (
    <AppShell title={BRAND.appName} subtitle={BRAND.tagline} showBackLink={false}>
      <div className={styles.greetingRow}>
        <div className={styles.greeting}>{timeOfDayGreeting()}, {currentUser.name}.</div>
        <Link href="/quotation" className={styles.primaryCta}>+ New Quotation</Link>
      </div>

      <div className={styles.attentionPanel}>
        <div className={styles.attentionHead}>Needs Your Attention</div>
        {attentionItems.length > 0 ? (
          <div className={styles.attentionList}>
            {attentionItems.map((item) => {
              const ItemIcon = ATTENTION_ICON[item.key];
              return (
                <Link key={item.key} href={item.href} className={`${styles.attentionRow} ${item.tone === 'urgent' ? styles.attentionUrgent : ''}`}>
                  <span className={styles.attentionIcon}>{ItemIcon && <ItemIcon size={15} />}</span>
                  <span className={styles.attentionLabel}>{item.label}</span>
                  <span className={styles.attentionCount}>{item.count}</span>
                  <span className={styles.attentionArrow}>→</span>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className={styles.attentionEmpty}>
            {attentionLoading ? (
              'Checking…'
            ) : (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <ALL_CAUGHT_UP_ICON size={16} /> You&apos;re all caught up.
              </span>
            )}
          </div>
        )}
      </div>

      {(myAssignedProjects.length > 0 || myAssignedDemos.length > 0) && (
        <div className={styles.recentGrid}>
          <div className={styles.recentCard}>
            <div className={styles.recentCardHead}>
              <h3>Projects Assigned to You</h3>
            </div>
            <div className={styles.recentList}>
              {myAssignedProjects.length === 0 && <div className={styles.recentEmpty}>None right now.</div>}
              {myAssignedProjects.map((p) => (
                <Link key={p.id} href={`/projects/${p.id}`} className={styles.recentRow}>
                  <div className={styles.recentRowMain}>
                    <div className={styles.recentRowTitle}>{p.client_name || p.company || `Project ${p.id}`}</div>
                    <div className={styles.recentRowMeta}>{PROJECT_STAGE_LABEL[p.stage] || p.stage}</div>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          <div className={styles.recentCard}>
            <div className={styles.recentCardHead}>
              <h3>Demos Assigned to You</h3>
              <Link href="/demo-schedule">View all →</Link>
            </div>
            <div className={styles.recentList}>
              {myAssignedDemos.length === 0 && <div className={styles.recentEmpty}>None right now.</div>}
              {myAssignedDemos.map((d) => (
                <Link key={d.id} href="/demo-schedule" className={styles.recentRow}>
                  <div className={styles.recentRowMain}>
                    <div className={styles.recentRowTitle}>{d.client_name}{d.company ? ` (${d.company})` : ''}</div>
                    <div className={styles.recentRowMeta}>{d.status.replace(/_/g, ' ')}</div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      {isManagerTier && (
        <>
          {/* KPIs below (kpis/quotationStats) already come department-scoped
              from the server for a non-org-wide manager — see
              lib/departmentScope.ts — so this panel doubles as the
              department-scoped "Sales Manager Dashboard"-style view without
              a separate endpoint; the heading names the department(s) when
              there's a clear one to name. */}
          <div className={styles.sectionHeading}>
            {managedDepartments.length === 1 ? `${managedDepartments[0]} Team Overview` : 'Team Overview'}
          </div>
          <div className={styles.kpiGrid}>
            <div className={styles.kpiCard}>
              <div className={styles.kpiValue}>{kpis ? kpis.totalProjects : '—'}</div>
              <div className={styles.kpiLabel}>Total Projects</div>
            </div>
            <div className={styles.kpiCard}>
              <div className={styles.kpiValue}>{kpis ? kpis.activeProjects : '—'}</div>
              <div className={styles.kpiLabel}>Active Projects</div>
            </div>
            <div className={styles.kpiCard}>
              <div className={styles.kpiValue}>{quotationStats ? quotationStats.sent : '—'}</div>
              <div className={styles.kpiLabel}>Quotations Sent</div>
            </div>
            <div className={styles.kpiCard}>
              <div className={styles.kpiValue}>{kpis ? kpis.pendingApprovals : '—'}</div>
              <div className={styles.kpiLabel}>Pending Approvals</div>
            </div>
            <div className={styles.kpiCard}>
              <div className={styles.kpiValue}>{kpis ? `${kpis.conversionRate}%` : '—'}</div>
              <div className={styles.kpiLabel}>Conversion Rate</div>
            </div>
          </div>
        </>
      )}

      <div className={styles.recentGrid}>
        <div className={styles.recentCard}>
          <div className={styles.recentCardHead}>
            <h3>Recent Projects</h3>
            <Link href="/projects">View all →</Link>
          </div>
          <div className={styles.recentList}>
            {recentProjects === null && <div className={styles.recentEmpty}>Loading…</div>}
            {recentProjects?.length === 0 && <div className={styles.recentEmpty}>No projects yet.</div>}
            {recentProjects?.map((p) => (
              <Link key={p.id} href={`/projects/${p.id}`} className={styles.recentRow}>
                <div className={styles.recentRowMain}>
                  <div className={styles.recentRowTitle}>{p.client_name || p.company || `Project ${p.id}`}</div>
                  <div className={styles.recentRowMeta}>{PROJECT_STAGE_LABEL[p.stage] || p.stage}</div>
                </div>
              </Link>
            ))}
          </div>
        </div>

        <div className={styles.recentCard}>
          <div className={styles.recentCardHead}>
            <h3>Recent Quotations</h3>
            <Link href="/my-quotations">View all →</Link>
          </div>
          <div className={styles.recentList}>
            {recentQuotations === null && <div className={styles.recentEmpty}>Loading…</div>}
            {recentQuotations?.length === 0 && <div className={styles.recentEmpty}>No quotations yet.</div>}
            {recentQuotations?.map((q) => (
              <Link key={q.id} href="/my-quotations" className={styles.recentRow}>
                <div className={styles.recentRowMain}>
                  <div className={styles.recentRowTitle}>{q.quotation_number}</div>
                  <div className={styles.recentRowMeta}>{q.client_company || q.client_name || 'No client name'}</div>
                </div>
                <div className={styles.recentRowAmount}>{formatMoney(q.total)}</div>
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className={styles.kpiGrid}>
        <Link href="/analytics" className={styles.kpiCard}>
          <div className={styles.kpiValue}><ANALYTICS_ICON size={22} /></div>
          <div className={styles.kpiLabel}>View Full Analytics &rarr;</div>
        </Link>
      </div>

      {orderedSections.map((section) => {
        const SectionToggleIcon = sectionIconFor(section.label);
        return (
          <div key={section.label}>
            <button type="button" className={styles.sectionToggle} aria-expanded={isExpanded(section.label)} onClick={() => toggle(section.label)}>
              <span className={styles.sectionToggleIcon}><SectionToggleIcon size={14} /></span>
              <span className={styles.sectionToggleLabel}>{section.label}</span>
              <span className={styles.sectionToggleCount}>{section.tiles.length}</span>
              <span className={styles.sectionChevron}>›</span>
            </button>
            {isExpanded(section.label) && (
              <div className={styles.grid}>
                {section.tiles.map((tile) => (
                  <Link key={tile.id} href={tile.href} className={styles.tile}>
                    <span className={styles.tileTitle}>{tile.label}</span>
                    <span className={styles.tileDesc}>{tile.desc}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </AppShell>
  );
}
