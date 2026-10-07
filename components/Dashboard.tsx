'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { DemoScheduleRecord, ModuleConfigRecord, ProjectHandoverRecord, ProjectRecord, QuotationRecord, UserRole } from '@/lib/types';
import { TechnicalRosterEntry } from '@/lib/technicalRoster';
import type { SalesTeamSummaryRow } from '@/lib/salesTeamSummary';
import { STAGE_LABEL as PROJECT_STAGE_LABEL } from '@/lib/projectStages';
import {
  PROJECT_DEPARTMENTS,
  PROJECT_DEPARTMENT_LABEL,
  departmentValueOf,
  matchesDepartmentFilter
} from '@/lib/projectDepartmentOptions';
import { formatMoney } from '@/lib/format';
import AppShell from './AppShell';
import HealthGauge from './ui/HealthGauge';
import DepartmentHealthDetail from './DepartmentHealthDetail';
import { BRAND } from '@/lib/branding';
import { useModuleSections } from '@/lib/useModuleSections';
import { useCollapsibleSections } from '@/lib/useCollapsibleSections';
import { primarySectionForDepartment } from '@/lib/departmentCategoryMap';
import { sectionIconFor, ATTENTION_ICON, ALL_CAUGHT_UP_ICON, ANALYTICS_ICON, DUE_SECTION_ICON } from '@/lib/icons';
import { Users as UsersIcon, X } from 'lucide-react';
import Drawer from './ui/Drawer';
import Modal from './ui/Modal';
import { hasSeenCelebrationPopup, markCelebrationPopupSeen } from '@/lib/celebrationPopupSeen';
import Table from './ui/Table';
import StatusBadge from './ui/StatusBadge';
import EmptyState from './ui/EmptyState';
import CelebrationsSection from './CelebrationsSection';
import styles from './dashboard.module.css';

// How many rows the Dashboard panel itself shows before collapsing the rest
// behind "View All" — keeps the panel a fixed, small size at login instead
// of growing tall whenever several things need attention at once.
const ATTENTION_COMPACT_LIMIT = 3;

// Which module section the Sales-leadership "Due" bar is pinned beneath, and
// the label/expand-state key it uses (shared with useCollapsibleSections, so
// open/closed persists exactly like a real section's does).
const DUE_AFTER_SECTION = 'Workspace';
const DUE_SECTION_LABEL = 'Due';

interface DashboardProps {
  currentUser: { id: string; username: string; name: string; role: UserRole; department?: string; isPrivileged: boolean };
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
  pendingDispatch: number;
}

interface HealthGaugeData {
  department: string;
  score: number;
  band: 'red' | 'yellow' | 'green' | 'na';
  breakdown: { label: string; value: string }[];
}

interface HealthResponse {
  scope: 'org' | 'department' | 'self';
  gauges: HealthGaugeData[];
}

interface AttentionItem {
  key: string;
  label: string;
  count: number;
  href: string;
  tone: 'urgent' | 'info';
  // Which of the two panels this row belongs in for a Sales Manager / Admin /
  // Super Admin (see `salesLeadership`): 'pending' is a request sitting on
  // somebody's desk waiting to be approved, confirmed or responded to —
  // there's a decision to make. 'due' is everything driven by a clock
  // instead: a follow-up overdue, a reminder falling due, today's new
  // arrivals. Every other role still sees one combined list, so the field is
  // inert for them.
  group: 'pending' | 'due';
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
  const [metaLeadsToday, setMetaLeadsToday] = useState<number>(0);
  const [marketingStats, setMarketingStats] = useState<{ isReviewer: boolean; awaitingReview?: number; myOpenCount?: number } | null>(null);
  const [marketingReminderUrgentCount, setMarketingReminderUrgentCount] = useState<number>(0);
  const [allProjects, setAllProjects] = useState<ProjectRecord[] | null>(null);
  const [recentQuotations, setRecentQuotations] = useState<QuotationRecord[] | null>(null);
  const [demos, setDemos] = useState<DemoScheduleRecord[] | null>(null);
  const [managersByDepartment, setManagersByDepartment] = useState<ManagersByDepartment>({});
  const [technicalRoster, setTechnicalRoster] = useState<TechnicalRosterEntry[]>([]);
  const [pendingHandovers, setPendingHandovers] = useState<ProjectHandoverRecord[]>([]);
  const [pendingTechnicalApprovals, setPendingTechnicalApprovals] = useState<{ project_id: string; project_label: string; requested_name: string }[]>([]);
  const [travelPendingCount, setTravelPendingCount] = useState<number>(0);
  const [pendingProjectConfirmations, setPendingProjectConfirmations] = useState<number>(0);
  // Both resolved server-side (app/api/dashboard/route.ts) — a Sales-side
  // Manager / Admin / Super Admin. `salesLeadership` alone decides the
  // reshaped top row, so it stays a flag of its own rather than being
  // inferred from salesTeamSummary being non-empty (a brand-new Sales
  // department with no reps yet is still Sales leadership).
  const [salesLeadership, setSalesLeadership] = useState(false);
  const [salesTeamSummary, setSalesTeamSummary] = useState<SalesTeamSummaryRow[] | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  // Which department's health detail dialog is open, by name (null = none).
  const [openHealthDepartment, setOpenHealthDepartment] = useState<string | null>(null);

  // Role Management's isPrivileged flag, resolved server-side — NOT
  // re-derived from role name, since an admin can toggle a role's
  // privileged status independently of what the role is called.
  const isPrivileged = currentUser.isPrivileged;
  const isBackOffice = currentUser.role === 'backoffice' || isPrivileged;

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

  // The "Due" bar is a peer of the module-section bars rather than a card in
  // the top row — it reads as a queue you open when you're ready to work it,
  // not something competing with "Needs Your Attention" for the first glance.
  // It sits directly under Workspace; module visibility is admin-configurable
  // though, so a viewer without a Workspace section gets it after their last
  // section instead (and after the whole list when they have none at all).
  const dueAfterSection = useMemo(() => {
    if (!orderedSections.length) return null;
    if (orderedSections.some((section) => section.label === DUE_AFTER_SECTION)) return DUE_AFTER_SECTION;
    return orderedSections[orderedSections.length - 1].label;
  }, [orderedSections]);

  // One round trip instead of what used to be up to 13 separate fetches
  // (modules, projects/kpis, backoffice/kpis, admin/quotations, site-visits,
  // leads/stats, marketing-requests/stats, projects, demo-schedule,
  // departments/managers, technical-roster, quotations/mine, quotations/
  // stats) — see app/api/dashboard/route.ts, which resolves the viewer once
  // and fans out server-side instead of once per client request. Role-gated
  // fields (followUpCount, backOfficeKpis) still come back null for a
  // viewer they don't apply to, same as before.
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
        setMetaLeadsToday(data.metaLeadsToday ?? 0);
        setMarketingStats(data.marketingStats ?? null);
        setMarketingReminderUrgentCount(data.marketingReminderUrgentCount ?? 0);
        setAllProjects(data.allProjects ?? []);
        setDemos(data.demos ?? []);
        setManagersByDepartment(data.managersByDepartment ?? {});
        setTechnicalRoster(data.technicalRoster ?? []);
        setRecentQuotations(data.recentQuotations ?? []);
        setPendingHandovers(data.pendingHandovers ?? []);
        setPendingTechnicalApprovals(data.pendingTechnicalApprovals ?? []);
        setTravelPendingCount(data.travelPendingCount ?? 0);
        setPendingProjectConfirmations(data.pendingProjectConfirmations ?? 0);
        setSalesLeadership(!!data.salesLeadership);
        setSalesTeamSummary(data.salesTeamSummary ?? null);
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
        setSalesLeadership(false);
        setSalesTeamSummary(null);
      });
  }, []);

  // Kept as its own fetch (not folded into /api/dashboard above) so the
  // traffic-light gauges load/refresh independently of the rest of the
  // page's data — see app/api/dashboard/health/route.ts and
  // lib/departmentScoring.ts for how each gauge's score is computed.
  useEffect(() => {
    fetch('/api/dashboard/health')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setHealth(data))
      .catch(() => setHealth(null));
  }, []);

  // Also its own fetch — this one has a side effect server-side (sending
  // today's birthday/anniversary emails the first time anyone's dashboard
  // loads that day; see app/api/dashboard/celebrations/route.ts and
  // lib/celebrationStore.ts, since there's no cron in this app to fire it
  // any other way), which shouldn't be tangled up with the rest of the
  // dashboard's plain read-only data fetch.
  // The server already caps how many of today's dashboard loads actually
  // return a non-empty list (see shouldShowCelebrationsPopup) — at most 3
  // per viewer per day, tracked per-user so it holds across devices. This
  // dismiss state only hides it for the rest of THIS page view; closing it
  // doesn't spend one of those 3 any faster or slower than just visiting did.
  const [celebrations, setCelebrations] = useState<{ userId: string; name: string; type: 'birthday' | 'anniversary'; years?: number }[]>([]);
  // Shown once per login, not once per visit. It used to reappear on every
  // dashboard load for the rest of the day, because dismissing it only set
  // state that a reload threw away — so the same person got interrupted by
  // the same popup several times a day. lib/celebrationPopupSeen.ts remembers
  // it per user per day, and every sign-out path clears that, so a fresh
  // login on a birthday still shows it.
  const [celebrationsDismissed, setCelebrationsDismissed] = useState(false);
  // Read once, lazily, instead of in an effect. `null` on the server, where
  // there is no localStorage. Safe for hydration because the popup cannot
  // render on that first pass either way — `celebrations` is empty until the
  // fetch below returns — so the server and client agree on the output.
  const [celebrationsAlreadySeen] = useState<boolean | null>(() =>
    typeof window === 'undefined' ? null : hasSeenCelebrationPopup(currentUser.username)
  );
  useEffect(() => {
    fetch('/api/dashboard/celebrations')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setCelebrations(data?.celebrations ?? []))
      .catch(() => setCelebrations([]));
  }, []);

  const showCelebrations = celebrations.length > 0 && celebrationsAlreadySeen === false && !celebrationsDismissed;
  // Marked the moment it is actually on screen, not when it is closed:
  // "once" has to hold even for someone who navigates away or shuts the tab
  // without pressing Close, which is exactly how the repeats happened.
  useEffect(() => {
    if (showCelebrations) markCelebrationPopupSeen(currentUser.username);
  }, [showCelebrations, currentUser.username]);

  // Projects by delivery department, with each department's share of the
  // value beside its count. A project spanning AI and AV is counted under
  // BOTH — it genuinely is work for both teams — so the COUNTS deliberately
  // do not sum to the project total, which the card says outright rather
  // than leaving it to look like a miscount. The VALUES do sum, because
  // departmentValueOf gives each department only its own slice.
  //
  // Uses the same two functions as the Projects dashboard's own filter and
  // Total Value tile, so the card and that page can never disagree.
  const departmentBreakdown = useMemo(() => {
    const projects = allProjects ?? [];
    return {
      rows: PROJECT_DEPARTMENTS.map((key) => ({
        key,
        label: PROJECT_DEPARTMENT_LABEL[key],
        count: projects.filter((p) => matchesDepartmentFilter(p.departments, key)).length,
        value: projects.reduce((sum, p) => sum + departmentValueOf(p, key), 0)
      })),
      unset: projects.filter((p) => !(p.departments ?? []).length).length,
      multi: projects.filter((p) => (p.departments ?? []).length > 1).length,
      total: projects.length
    };
  }, [allProjects]);

  const recentProjects = useMemo(() => (allProjects ? [...allProjects].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)).slice(0, 3) : null), [allProjects]);

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
      items.push({ key: 'followup', group: 'due', label: `Quotation${followUpCount === 1 ? '' : 's'} needing a follow-up`, count: followUpCount, href: '/quotation-history', tone: 'urgent' });
    }
    if ((currentUser.role === 'engineer' || isPrivileged) && kpis?.pendingApprovals) {
      items.push({ key: 'demo-approvals', group: 'pending', label: `Demo request${kpis.pendingApprovals === 1 ? '' : 's'} awaiting approval`, count: kpis.pendingApprovals, href: '/demo-schedule', tone: 'urgent' });
    }
    if (isBackOffice && backOfficeKpis?.pendingDc) {
      items.push({ key: 'dc', group: 'pending', label: `Demo${backOfficeKpis.pendingDc === 1 ? '' : 's'} awaiting a Delivery Challan`, count: backOfficeKpis.pendingDc, href: '/backoffice', tone: 'urgent' });
    }
    if (isBackOffice && backOfficeKpis?.pendingDispatch) {
      items.push({ key: 'dc-dispatch', group: 'pending', label: `DC${backOfficeKpis.pendingDispatch === 1 ? '' : 's'} prepared and awaiting dispatch`, count: backOfficeKpis.pendingDispatch, href: '/backoffice', tone: 'urgent' });
    }
    if (isBackOffice && backOfficeKpis?.pendingVerification) {
      items.push({ key: 'dc-verify', group: 'pending', label: `DC${backOfficeKpis.pendingVerification === 1 ? '' : 's'} awaiting material return verification`, count: backOfficeKpis.pendingVerification, href: '/backoffice', tone: 'urgent' });
    }
    // A call queue, not a backlog of paperwork: a lead is assigned, and
    // nobody has rung it yet (lib/followUp.ts's isLeadUnattended, and
    // /api/dashboard scopes the count to this viewer's own assignments).
    // "Unattended leads" read as an unexplained scolding — this says what
    // the row actually wants done about it.
    if (unattendedLeads) {
      items.push({ key: 'leads', group: 'due', label: `Lead${unattendedLeads === 1 ? '' : 's'} assigned to you with no call logged`, count: unattendedLeads, href: '/leads?filter=unattended&assignee=me', tone: 'urgent' });
    }
    if (metaLeadsToday) {
      items.push({ key: 'meta-leads', group: 'due', label: `New Meta lead${metaLeadsToday === 1 ? '' : 's'} today`, count: metaLeadsToday, href: '/leads', tone: 'info' });
    }
    if (marketingStats?.isReviewer && marketingStats.awaitingReview) {
      items.push({ key: 'marketing', group: 'pending', label: 'Marketing tickets awaiting review', count: marketingStats.awaitingReview, href: '/marketing-requests?filter=submitted', tone: 'info' });
    }
    if (marketingReminderUrgentCount) {
      items.push({
        key: 'marketing-reminders',
        group: 'due',
        label: `Marketing request${marketingReminderUrgentCount === 1 ? '' : 's'} due today or overdue`,
        count: marketingReminderUrgentCount,
        href: '/marketing-requests?filter=due',
        tone: 'urgent'
      });
    }
    if (reminderCount) {
      items.push({ key: 'sitevisit', group: 'due', label: `Site visit reminder${reminderCount === 1 ? '' : 's'} due`, count: reminderCount, href: '/site-visits?focus=open', tone: 'info' });
    }
    if (demosAwaitingMyConfirmation.length) {
      items.push({
        key: 'my-demo-confirm',
        group: 'pending',
        label: `Demo${demosAwaitingMyConfirmation.length === 1 ? '' : 's'} awaiting your confirmation`,
        count: demosAwaitingMyConfirmation.length,
        href: '/demo-schedule',
        tone: 'urgent'
      });
    }
    if (demosAwaitingMyApproval.length) {
      items.push({
        key: 'my-demo-approve',
        group: 'pending',
        label: `Demo${demosAwaitingMyApproval.length === 1 ? '' : 's'} awaiting your approval`,
        count: demosAwaitingMyApproval.length,
        href: '/demo-schedule',
        tone: 'urgent'
      });
    }
    if (pendingHandovers.length) {
      items.push({
        key: 'handover',
        group: 'pending',
        label: `Project handover request${pendingHandovers.length === 1 ? '' : 's'} awaiting your response`,
        count: pendingHandovers.length,
        href: `/projects/${pendingHandovers[0].project_id}`,
        tone: 'urgent'
      });
    }
    // A sales person asked for this viewer (or someone on the team they
    // manage) as a project's technical person — nothing is assigned until
    // it's approved, so this is urgent.
    if (pendingTechnicalApprovals.length) {
      items.push({
        key: 'technical-approval',
        group: 'pending',
        label: `Technical assignment request${pendingTechnicalApprovals.length === 1 ? '' : 's'} awaiting your approval`,
        count: pendingTechnicalApprovals.length,
        href: `/projects/${pendingTechnicalApprovals[0].project_id}`,
        tone: 'urgent'
      });
    }
    if (travelPendingCount) {
      items.push({
        key: 'travel',
        group: 'pending',
        label: `Travel request${travelPendingCount === 1 ? '' : 's'} needing your action`,
        count: travelPendingCount,
        href: '/travel-schedule',
        tone: 'urgent'
      });
    }
    if (pendingProjectConfirmations) {
      items.push({
        key: 'project-confirm',
        group: 'pending',
        label: `Project${pendingProjectConfirmations === 1 ? '' : 's'} awaiting your confirmation`,
        count: pendingProjectConfirmations,
        href: '/projects?filter=pending_confirmation',
        tone: 'urgent'
      });
    }
    // Urgent items surface first regardless of push order above, so the
    // compact (sliced) view on the Dashboard itself always shows the most
    // pressing items rather than whatever happened to be pushed earliest.
    return items.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'urgent' ? -1 : 1));
  }, [
    isPrivileged,
    followUpCount,
    currentUser.role,
    kpis,
    isBackOffice,
    backOfficeKpis,
    unattendedLeads,
    metaLeadsToday,
    marketingStats,
    marketingReminderUrgentCount,
    reminderCount,
    demosAwaitingMyConfirmation,
    demosAwaitingMyApproval,
    pendingHandovers,
    pendingTechnicalApprovals,
    travelPendingCount,
    pendingProjectConfirmations
  ]);

  // Sales leadership reads this queue as two different questions — "what is
  // waiting on a decision" and "what is falling due" — so the one list splits
  // in two for them (see AttentionItem.group). Every other role keeps the
  // single combined list it has always had, which is `attentionItems` whole.
  const pendingAttentionItems = useMemo(
    () => (salesLeadership ? attentionItems.filter((item) => item.group === 'pending') : attentionItems),
    [salesLeadership, attentionItems]
  );
  const dueAttentionItems = useMemo(
    () => (salesLeadership ? attentionItems.filter((item) => item.group === 'due') : []),
    [salesLeadership, attentionItems]
  );

  const [showAllAttention, setShowAllAttention] = useState(false);
  // The inline list now renders EVERY item and scrolls after
  // ATTENTION_COMPACT_LIMIT rows (see .attentionScroll), so this count no
  // longer decides what is rendered — only whether the full-screen drawer is
  // worth offering, which it still is once the list outgrows the panel.
  const hiddenAttentionCount = Math.max(0, pendingAttentionItems.length - ATTENTION_COMPACT_LIMIT);

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

  // Built once and placed by whichever slot in the section list matches
  // `dueAfterSection`, so the two placements can't drift apart.
  const dueSection = salesLeadership ? (
    <DueSection items={dueAttentionItems} loading={attentionLoading} isExpanded={isExpanded(DUE_SECTION_LABEL)} onToggle={() => toggle(DUE_SECTION_LABEL)} />
  ) : null;

  return (
    <AppShell title={BRAND.appName} subtitle={BRAND.tagline} showBackLink={false}>
      {showCelebrations && (
        <Modal
          title={
            <div className={styles.celebrationHeader}>
              <span>🎉 Today&apos;s Celebrations</span>
              <button
                type="button"
                className={styles.celebrationCloseBtn}
                onClick={() => setCelebrationsDismissed(true)}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
          }
          ariaLabel="Today's birthdays and work anniversaries"
          onClose={() => setCelebrationsDismissed(true)}
          footer={
            <button type="button" className={styles.celebrationOkBtn} onClick={() => setCelebrationsDismissed(true)}>
              Close
            </button>
          }
        >
          <div className={styles.celebrationList}>
            {celebrations.map((c) => (
              <div
                key={`${c.userId}-${c.type}`}
                className={`${styles.celebrationCard} ${c.type === 'birthday' ? styles.celebrationCardBirthday : styles.celebrationCardAnniversary}`}
              >
                <span className={styles.celebrationBadge}>{c.type === 'birthday' ? '🎂' : '🏆'}</span>
                <div className={styles.celebrationText}>
                  <div className={styles.celebrationName}>{c.name}</div>
                  <div className={styles.celebrationSub}>
                    {c.type === 'birthday'
                      ? 'has a birthday today! 🎈'
                      : `completes ${c.years} year${c.years === 1 ? '' : 's'} with us today! 🎊`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}
      <div className={styles.greetingRow}>
        <div className={styles.greeting}>{timeOfDayGreeting()}, {currentUser.name}.</div>
        <Link href="/quotation" className={styles.primaryCta}>+ New Quotation</Link>
      </div>

      <div className={`${styles.topGrid} ${salesLeadership ? styles.topGridPair : ''}`}>
        <div className={`${styles.attentionPanel} ${styles.topGridPanel} ${styles.topGridHighlight}`}>
          <div className={styles.attentionHead}>Needs Your Attention</div>
          {pendingAttentionItems.length > 0 ? (
            <>
              <div className={`${styles.attentionList} ${styles.attentionScroll}`}>
                {pendingAttentionItems.map((item) => (
                  <AttentionRow key={item.key} item={item} />
                ))}
              </div>
              {hiddenAttentionCount > 0 && (
                <button type="button" className={styles.attentionViewAll} onClick={() => setShowAllAttention(true)}>
                  View All ({pendingAttentionItems.length})
                </button>
              )}
            </>
          ) : (
            <div className={styles.attentionEmpty}>
              {attentionLoading ? (
                'Checking\u2026'
              ) : (
                <span className={styles.attentionAllCaughtUp}>
                  <ALL_CAUGHT_UP_ICON size={16} /> You&apos;re all caught up.
                </span>
              )}
            </div>
          )}
        </div>

        {/* Sales leadership gets the Sales Team Summary in the space the
            Recent Projects / Recent Quotations pair occupies for everyone
            else — a six-column table needs both of those columns to itself. */}
        {salesLeadership ? (
          <SalesTeamSummaryPanel rows={salesTeamSummary} />
        ) : (
          <>
            <div className={styles.recentCard}>
              <div className={styles.recentCardHead}>
                <h3>Recent Projects</h3>
                <Link href="/projects">View all &rarr;</Link>
              </div>
              <div className={styles.recentList}>
                {recentProjects === null && <div className={styles.recentEmpty}>Loading&hellip;</div>}
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
                <h3>Projects by Department</h3>
                <Link href="/projects">View all &rarr;</Link>
              </div>
              <div className={styles.recentList}>
                {allProjects === null && <div className={styles.recentEmpty}>Loading&hellip;</div>}
                {allProjects !== null && departmentBreakdown.total === 0 && <div className={styles.recentEmpty}>No projects yet.</div>}
                {allProjects !== null && departmentBreakdown.total > 0 && (
                  <>
                    {departmentBreakdown.rows.map((row) => (
                      <Link key={row.key} href={`/projects?department=${row.key}`} className={styles.recentRow}>
                        <div className={styles.recentRowMain}>
                          <div className={styles.recentRowTitle}>{row.label}</div>
                          <div className={styles.recentRowMeta}>{formatMoney(row.value)}</div>
                        </div>
                        <div className={styles.recentRowAmount}>{row.count}</div>
                      </Link>
                    ))}
                    {departmentBreakdown.multi > 0 && (
                      <div className={styles.recentRow}>
                        <div className={styles.recentRowMain}>
                          <div className={styles.recentRowMeta}>
                            {departmentBreakdown.multi} project{departmentBreakdown.multi === 1 ? ' spans' : 's span'} more than one
                            department and {departmentBreakdown.multi === 1 ? 'is' : 'are'} counted under each — values are split, counts are not.
                          </div>
                        </div>
                      </div>
                    )}
                    {departmentBreakdown.unset > 0 && (
                      <div className={styles.recentRow}>
                        <div className={styles.recentRowMain}>
                          <div className={styles.recentRowTitle}>Not set</div>
                          <div className={styles.recentRowMeta}>Created before departments were tracked</div>
                        </div>
                        <div className={styles.recentRowAmount}>{departmentBreakdown.unset}</div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className={styles.recentCard}>
              <div className={styles.recentCardHead}>
                <h3>Recent Quotations</h3>
                <Link href="/my-quotations">View all &rarr;</Link>
              </div>
              <div className={styles.recentList}>
                {recentQuotations === null && <div className={styles.recentEmpty}>Loading&hellip;</div>}
                {recentQuotations?.length === 0 && <div className={styles.recentEmpty}>No quotations yet.</div>}
                {recentQuotations?.map((q) => (
                  <Link key={q.id} href={`/my-quotations?highlight=${q.id}`} className={styles.recentRow}>
                    <div className={styles.recentRowMain}>
                      <div className={styles.recentRowTitle}>{q.quotation_number}</div>
                      <div className={styles.recentRowMeta}>{q.client_company || q.client_name || 'No client name'}</div>
                    </div>
                    <div className={styles.recentRowAmount}>{formatMoney(q.total)}</div>
                  </Link>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {showAllAttention && (
        <Drawer title="Needs Your Attention" ariaLabel="Everything needing your attention" onClose={() => setShowAllAttention(false)}>
          <div className={styles.attentionList}>
            {pendingAttentionItems.map((item) => (
              <AttentionRow key={item.key} item={item} onNavigate={() => setShowAllAttention(false)} />
            ))}
          </div>
        </Drawer>
      )}

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

      {health && health.gauges.length > 0 && (
        <>
          {/* One traffic-light gauge per department the viewer is allowed to
              see — org-wide gets every department, a department manager
              gets just their own, everyone else gets one personal gauge.
              See app/api/dashboard/health/route.ts + lib/departmentScoring.ts
              for how scope/scoring is resolved. Clicking a gauge opens
              DepartmentHealthDetail, which lazy-loads the per-member
              breakdown from /api/dashboard/health/[department]. */}
          <div className={styles.healthHead}>
            <div className={styles.sectionHeading}>
              {health.scope === 'org'
                ? 'Department Health'
                : health.scope === 'department'
                  ? health.gauges.length === 1
                    ? `${health.gauges[0].department} Team Health`
                    : 'Team Health'
                  : 'Your Performance'}
            </div>
            {/* Legend, so the band colours are readable without opening a gauge. */}
            <div className={styles.healthLegend}>
              <span className={styles.legendItem}><i className={styles.legendDotDanger} /> Below 40</span>
              <span className={styles.legendItem}><i className={styles.legendDotWarning} /> 40–69</span>
              <span className={styles.legendItem}><i className={styles.legendDotSuccess} /> 70+</span>
            </div>
          </div>
          <div className={styles.healthGrid}>
            {[...health.gauges]
              // Worst first: the gauge that needs attention shouldn't be
              // whichever one happens to sort last alphabetically. Unscored
              // ('na') departments go to the end rather than reading as 0%.
              .sort((a, b) => {
                if (a.band === 'na' && b.band === 'na') return a.department.localeCompare(b.department);
                if (a.band === 'na') return 1;
                if (b.band === 'na') return -1;
                return a.score - b.score;
              })
              .map((g) => (
                <HealthGauge
                  key={g.department}
                  label={g.department}
                  score={g.score}
                  band={g.band}
                  breakdown={g.breakdown}
                  onOpen={() => setOpenHealthDepartment(g.department)}
                />
              ))}
          </div>
        </>
      )}

      {openHealthDepartment && (
        <DepartmentHealthDetail
          department={openHealthDepartment}
          onClose={() => setOpenHealthDepartment(null)}
          // Only rendered by DepartmentHealthDetail in its self-only branch
          // (a non-privileged, non-department-manager viewer), where
          // allProjects — already scoped by /api/dashboard's
          // projectStore.listLight to exactly what this viewer may see — IS
          // exactly "my projects" by construction, no extra filtering needed.
          myProjects={allProjects || []}
        />
      )}

      {/* Upcoming birthdays / work anniversaries — used to be its own
          "HR Dashboard" page; it's a whole-company thing, not an HR one, so
          it lives here now. See components/CelebrationsSection.tsx. */}
      <div className={styles.sectionHeading}>Celebrations</div>
      <CelebrationsSection />

      <div className={styles.kpiGrid}>
        <Link href="/analytics" className={styles.kpiCard}>
          <div className={styles.kpiValue}><ANALYTICS_ICON size={22} /></div>
          <div className={styles.kpiLabel}>View Full Analytics &rarr;</div>
        </Link>
      </div>

      {orderedSections.map((section) => {
        const SectionToggleIcon = sectionIconFor(section.label);
        return (
          <Fragment key={section.label}>
            <div>
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
            {dueAfterSection === section.label && dueSection}
          </Fragment>
        );
      })}

      {/* No module sections at all (none visible to this role, or still
          loading) — the bar still has to appear somewhere. */}
      {dueAfterSection === null && dueSection}
    </AppShell>
  );
}

// Sits among the module-section bars, styled as one of them, so a Sales
// Manager / Admin / Super Admin can collapse the clock-driven half of their
// queue away and still see its count. Unlike "Needs Your Attention" there's
// no 3-row cap or "View All" drawer here — it's already collapsed by default
// and full width when opened, so the whole list fits.
function DueSection({
  items,
  loading,
  isExpanded,
  onToggle
}: {
  items: AttentionItem[];
  loading: boolean;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div>
      <button type="button" className={styles.sectionToggle} aria-expanded={isExpanded} onClick={onToggle}>
        <span className={styles.sectionToggleIcon}><DUE_SECTION_ICON size={14} /></span>
        <span className={styles.sectionToggleLabel}>{DUE_SECTION_LABEL}</span>
        <span className={styles.sectionToggleCount}>{items.length}</span>
        <span className={styles.sectionChevron}>›</span>
      </button>
      {isExpanded && (
        <div className={styles.dueBody}>
          {items.length > 0 ? (
            <div className={styles.attentionList}>
              {items.map((item) => (
                <AttentionRow key={item.key} item={item} />
              ))}
            </div>
          ) : (
            <div className={styles.attentionEmpty}>
              {loading ? (
                'Checking\u2026'
              ) : (
                <span className={styles.attentionAllCaughtUp}>
                  <ALL_CAUGHT_UP_ICON size={16} /> Nothing due right now.
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Replaces the Recent Projects / Recent Quotations cards for Sales
// leadership: one row per rep, read left to right as the funnel they work
// (Lead -> Enquiry -> Quotation -> Billing -> Won/Lost). Every figure is
// computed server-side in lib/salesTeamSummary.ts — see that file for what
// each column counts and how it's attributed.
function SalesTeamSummaryPanel({ rows }: { rows: SalesTeamSummaryRow[] | null }) {
  return (
    <div className={styles.summaryCard}>
      <div className={styles.recentCardHead}>
        <h3>Sales Team Summary</h3>
      </div>
      {rows === null ? (
        <div className={styles.recentEmpty}>Loading&hellip;</div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={UsersIcon}
          title="No Sales Team members yet"
          message="Add active employees to the Sales or GEM - Sales department to see their pipeline here."
        />
      ) : (
        <Table
          rows={rows}
          rowKey={(row) => row.id}
          tableClassName={styles.summaryTable}
          wrapClassName={styles.summaryViewport}
          columns={[
            { key: 'name', header: 'Name', render: (row: SalesTeamSummaryRow) => row.name },
            { key: 'leads', header: 'Lead', headerClassName: styles.summaryNum, cellClassName: styles.summaryNum, render: (row: SalesTeamSummaryRow) => row.leads },
            { key: 'enquiries', header: 'Enquiry', headerClassName: styles.summaryNum, cellClassName: styles.summaryNum, render: (row: SalesTeamSummaryRow) => row.enquiries },
            { key: 'quotations', header: 'Quotation', headerClassName: styles.summaryNum, cellClassName: styles.summaryNum, render: (row: SalesTeamSummaryRow) => row.quotations },
            {
              key: 'billing',
              header: 'Billing',
              headerClassName: styles.summaryNum,
              cellClassName: styles.summaryNum,
              render: (row: SalesTeamSummaryRow) => (row.billing ? formatMoney(row.billing) : '\u2014')
            },
            {
              key: 'status',
              header: 'Status',
              render: (row: SalesTeamSummaryRow) =>
                row.won || row.lost ? (
                  <span className={styles.summaryStatus}>
                    {row.won > 0 && <StatusBadge tone="won" label={`${row.won} Won`} />}
                    {row.lost > 0 && <StatusBadge tone="lost" label={`${row.lost} Lost`} />}
                  </span>
                ) : (
                  // Nothing decided yet — deliberately not "0 Won", which
                  // reads as a result rather than an open pipeline.
                  '\u2014'
                )
            }
          ]}
        />
      )}
    </div>
  );
}

// Shared between the compact panel and the "View All" drawer so the two
// never visually drift apart. `onNavigate` closes the drawer on click —
// harmless when rendered in the compact panel, which never passes it.
function AttentionRow({ item, onNavigate }: { item: AttentionItem; onNavigate?: () => void }) {
  const ItemIcon = ATTENTION_ICON[item.key];
  return (
    <Link href={item.href} className={`${styles.attentionRow} ${item.tone === 'urgent' ? styles.attentionUrgent : ''}`} onClick={onNavigate}>
      <span className={styles.attentionIcon}>{ItemIcon && <ItemIcon size={15} />}</span>
      <span className={styles.attentionLabel}>{item.label}</span>
      <span className={styles.attentionCount}>{item.count}</span>
      <span className={styles.attentionArrow}>→</span>
    </Link>
  );
}
