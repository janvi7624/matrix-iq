'use client';

import { createElement, Fragment, useEffect, useMemo, useState } from 'react';
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
import HealthGauge, { BAND_COLOR, BAND_TEXT } from './ui/HealthGauge';
import DepartmentHealthDetail from './DepartmentHealthDetail';
import { BRAND } from '@/lib/branding';
import { useModuleSections } from '@/lib/useModuleSections';
import { useCollapsibleSections } from '@/lib/useCollapsibleSections';
import { primarySectionForDepartment } from '@/lib/departmentCategoryMap';
import { sectionIconFor, resolveModuleIcon, ATTENTION_ICON, ALL_CAUGHT_UP_ICON, ANALYTICS_ICON, DUE_SECTION_ICON, departmentIconFor } from '@/lib/icons';
import {
  ChevronRight,
  Contact,
  FileText,
  Briefcase,
  IndianRupee,
  ListChecks,
  Users as UsersIcon,
  X,
  Plus,
  Search,
  CheckCircle2,
  Calendar,
  Sun,
  SunMedium,
  Moon,
  ShieldCheck,
  BarChart3,
  Layers,
  Sparkles,
  Zap,
  ArrowRight,
  LayoutGrid,
  ListFilter,
  AlertTriangle,
  Trophy,
  Activity,
  Table as TableIcon,
  Copy,
  Check
} from 'lucide-react';
import Modal from './ui/Modal';
import { hasSeenCelebrationPopup, markCelebrationPopupSeen } from '@/lib/celebrationPopupSeen';
import Table from './ui/Table';
import StatusBadge from './ui/StatusBadge';
import EmptyState from './ui/EmptyState';
import CelebrationsSection from './CelebrationsSection';
import MyTargetPanel from './MyTargetPanel';
import styles from './dashboard.module.css';

const DUE_AFTER_SECTION = 'Workspace';
const DUE_SECTION_LABEL = 'Due';

interface DashboardProps {
  currentUser: { id: string; username: string; name: string; role: UserRole; department?: string; isPrivileged: boolean };
}

type ManagersByDepartment = Record<string, { id: string; username: string; name: string }[]>;

interface Kpis {
  pendingApprovals: number;
  totalProjects: number;
  activeProjects: number;
  conversionRate: number;
}

interface HeadlineKpis {
  totalLeads: number;
  totalQuotations: number;
  totalQuotationValue: number;
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
  group: 'pending' | 'due';
}

function getInitials(name: string): string {
  if (!name) return 'U';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getTimeGreeting(): { text: string; Icon: typeof Sun } {
  const hour = new Date().getHours();
  if (hour < 12) return { text: 'Good morning', Icon: Sun };
  if (hour < 17) return { text: 'Good afternoon', Icon: SunMedium };
  return { text: 'Good evening', Icon: Moon };
}

function getFormattedDate(): string {
  const now = new Date();
  return now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

const SECTION_DESCRIPTIONS: Record<string, string> = {
  Workspace: 'Core everyday productivity and task overview',
  Sales: 'Commercial pipeline, leads, estimations, and quotes',
  Technical: 'Engineering rosters, BOMs, and TMS project deliverables',
  Operations: 'Logistics, material inventory, and travel schedules',
  Accounts: 'Financial vouchers, reimbursements, and payouts',
  HR: 'Staff attendance, leave oversight, and team records',
  Administration: 'System configurations, roles, and module management',
  Reports: 'Executive reporting, summaries, and audit tracking'
};

export default function Dashboard({ currentUser }: DashboardProps) {
  const [followUpCount, setFollowUpCount] = useState<number | null>(null);
  const [reminderCount, setReminderCount] = useState<number | null>(null);
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [backOfficeKpis, setBackOfficeKpis] = useState<BackOfficeKpis | null>(null);
  const [headlineKpis, setHeadlineKpis] = useState<HeadlineKpis | null>(null);
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
  const [salesLeadership, setSalesLeadership] = useState(false);
  const [salesTeamSummary, setSalesTeamSummary] = useState<SalesTeamSummaryRow[] | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [openHealthDepartment, setOpenHealthDepartment] = useState<string | null>(null);

  // Health Section Controls
  const [healthBandFilter, setHealthBandFilter] = useState<'all' | 'red' | 'yellow' | 'green'>('all');
  const [healthSortOrder, setHealthSortOrder] = useState<'priority' | 'top' | 'alpha'>('priority');
  const [healthViewMode, setHealthViewMode] = useState<'cards' | 'leaderboard'>('cards');
  const [healthSearchQuery, setHealthSearchQuery] = useState('');
  const [copiedHealthToast, setCopiedHealthToast] = useState(false);

  // Module Directory Controls
  const [moduleSearchQuery, setModuleSearchQuery] = useState('');
  const [selectedCategoryTab, setSelectedCategoryTab] = useState<string>('all');
  const [moduleViewMode, setModuleViewMode] = useState<'accordion' | 'grid'>('accordion');

  const isPrivileged = currentUser.isPrivileged;
  const isBackOffice = currentUser.role === 'backoffice' || isPrivileged;

  const sections = useModuleSections(modules);

  const primarySection = primarySectionForDepartment(currentUser.department);
  const orderedSections = useMemo(() => {
    if (!primarySection) return sections;
    const idx = sections.findIndex((s) => s.label === primarySection);
    if (idx <= 0) return sections;
    return [sections[idx], ...sections.slice(0, idx), ...sections.slice(idx + 1)];
  }, [sections, primarySection]);

  const allSectionLabels = useMemo(
    () => [...orderedSections.map((section) => section.label), ...(salesLeadership ? [DUE_SECTION_LABEL] : [])],
    [orderedSections, salesLeadership]
  );

  const { isExpanded, toggle } = useCollapsibleSections(primarySection, { accordion: true, allLabels: allSectionLabels });

  const dueAfterSection = useMemo(() => {
    if (!orderedSections.length) return null;
    if (orderedSections.some((section) => section.label === DUE_AFTER_SECTION)) return DUE_AFTER_SECTION;
    return orderedSections[orderedSections.length - 1].label;
  }, [orderedSections]);

  useEffect(() => {
    fetch('/api/dashboard')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        setModules(data.modules ?? []);
        setKpis(data.kpis ?? null);
        setBackOfficeKpis(data.backOfficeKpis ?? null);
        setHeadlineKpis(data.headlineKpis ?? null);
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

  useEffect(() => {
    fetch('/api/dashboard/health')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setHealth(data))
      .catch(() => setHealth(null));
  }, []);

  const [celebrations, setCelebrations] = useState<{ userId: string; name: string; type: 'birthday' | 'anniversary'; years?: number }[]>([]);
  const [celebrationsDismissed, setCelebrationsDismissed] = useState(false);
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

  useEffect(() => {
    if (showCelebrations) markCelebrationPopupSeen(currentUser.username);
  }, [showCelebrations, currentUser.username]);

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

  const pendingAttentionItems = useMemo(
    () => (salesLeadership ? attentionItems.filter((item) => item.group === 'pending') : attentionItems),
    [salesLeadership, attentionItems]
  );
  const dueAttentionItems = useMemo(
    () => (salesLeadership ? attentionItems.filter((item) => item.group === 'due') : []),
    [salesLeadership, attentionItems]
  );

  const urgentAttentionCount = useMemo(
    () => pendingAttentionItems.filter((item) => item.tone === 'urgent').length,
    [pendingAttentionItems]
  );

  const attentionLoading =
    reminderCount === null ||
    unattendedLeads === null ||
    kpis === null ||
    marketingStats === null ||
    (isPrivileged && followUpCount === null) ||
    (isBackOffice && backOfficeKpis === null);

  const dueSection = salesLeadership ? (
    <DueSection items={dueAttentionItems} loading={attentionLoading} isExpanded={isExpanded(DUE_SECTION_LABEL)} onToggle={() => toggle(DUE_SECTION_LABEL)} />
  ) : null;

  // Flattened modules and search/filter logic
  const allFlattenedModules = useMemo(() => {
    const list: { id: string; label: string; desc: string; href: string; icon: string; category: string }[] = [];
    for (const sec of orderedSections) {
      for (const tile of sec.tiles) {
        list.push({ ...tile, category: sec.label });
      }
    }
    return list;
  }, [orderedSections]);

  const categoryList = useMemo(() => {
    return ['all', ...orderedSections.map((s) => s.label)];
  }, [orderedSections]);

  const visibleSections = useMemo(() => {
    if (selectedCategoryTab === 'all') return orderedSections;
    return orderedSections.filter((s) => s.label === selectedCategoryTab);
  }, [orderedSections, selectedCategoryTab]);

  const filteredModules = useMemo(() => {
    const query = moduleSearchQuery.trim().toLowerCase();
    if (!query) return null;
    return allFlattenedModules.filter(
      (m) =>
        m.label.toLowerCase().includes(query) ||
        m.desc.toLowerCase().includes(query) ||
        m.category.toLowerCase().includes(query)
    );
  }, [allFlattenedModules, moduleSearchQuery]);

  // Health Stats & Filtering
  const healthStats = useMemo(() => {
    if (!health || !health.gauges.length) return null;
    const total = health.gauges.length;
    const redCount = health.gauges.filter((g) => g.band === 'red').length;
    const yellowCount = health.gauges.filter((g) => g.band === 'yellow').length;
    const greenCount = health.gauges.filter((g) => g.band === 'green').length;
    const scoredGauges = health.gauges.filter((g) => g.band !== 'na');
    const avgScore = scoredGauges.length
      ? Math.round(scoredGauges.reduce((sum, g) => sum + g.score, 0) / scoredGauges.length)
      : 0;

    const topDept = scoredGauges.length
      ? [...scoredGauges].sort((a, b) => b.score - a.score)[0]
      : null;

    const riskDept = redCount > 0
      ? [...scoredGauges].filter((g) => g.band === 'red').sort((a, b) => a.score - b.score)[0]
      : null;

    return { total, redCount, yellowCount, greenCount, avgScore, topDept, riskDept };
  }, [health]);

  const filteredAndSortedGauges = useMemo(() => {
    if (!health) return [];
    let list = [...health.gauges];

    if (healthBandFilter !== 'all') {
      list = list.filter((g) => g.band === healthBandFilter);
    }

    const query = healthSearchQuery.trim().toLowerCase();
    if (query) {
      list = list.filter((g) => g.department.toLowerCase().includes(query));
    }

    if (healthSortOrder === 'priority') {
      list.sort((a, b) => {
        if (a.band === 'na' && b.band === 'na') return a.department.localeCompare(b.department);
        if (a.band === 'na') return 1;
        if (b.band === 'na') return -1;
        return a.score - b.score;
      });
    } else if (healthSortOrder === 'top') {
      list.sort((a, b) => {
        if (a.band === 'na' && b.band === 'na') return a.department.localeCompare(b.department);
        if (a.band === 'na') return 1;
        if (b.band === 'na') return -1;
        return b.score - a.score;
      });
    } else if (healthSortOrder === 'alpha') {
      list.sort((a, b) => a.department.localeCompare(b.department));
    }

    return list;
  }, [health, healthBandFilter, healthSortOrder, healthSearchQuery]);

  function handleCopyHealthReport() {
    if (!health || !health.gauges.length) return;
    const lines = [
      `📊 MatrixIQ Executive Department Health Report — ${new Date().toLocaleDateString()}`,
      `Average Org Health: ${healthStats?.avgScore ?? 0}% (${healthStats?.total ?? 0} active departments)`,
      `Needs Attention: ${healthStats?.redCount ?? 0} | On Track: ${healthStats?.yellowCount ?? 0} | Performing: ${healthStats?.greenCount ?? 0}`,
      '',
      'Department Performance Breakdown:',
      ...filteredAndSortedGauges.map(
        (g, idx) =>
          `#${idx + 1} ${g.department}: ${g.band === 'na' ? 'No Data' : `${g.score}%`} [${BAND_TEXT[g.band]}]${g.breakdown[0] ? ` — ${g.breakdown[0].label}: ${g.breakdown[0].value}` : ''}`
      )
    ].join('\n');

    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(lines).then(() => {
        setCopiedHealthToast(true);
        setTimeout(() => setCopiedHealthToast(false), 2400);
      });
    }
  }

  const greeting = useMemo(() => getTimeGreeting(), []);
  const formattedDate = useMemo(() => getFormattedDate(), []);
  const totalModuleCount = allFlattenedModules.length;

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

      {/* 1. HERO BANNER & GREETING HEADER */}
      <section className={styles.heroBanner} aria-label="Welcome and quick actions">
        <div className={styles.heroContent}>
          <div className={styles.heroAvatarWrapper}>
            <div className={styles.heroAvatar}>{getInitials(currentUser.name)}</div>
            <span className={styles.heroAvatarStatus} title="Active Online" />
          </div>
          <div className={styles.heroText}>
            <div className={styles.heroGreetingRow}>
              <span className={styles.heroGreetingIcon}><greeting.Icon size={18} /></span>
              <h1 className={styles.heroTitle}>{greeting.text}, {currentUser.name.split(' ')[0]}</h1>
            </div>
            <div className={styles.heroSubtitleRow}>
              <span className={styles.heroDate}>
                <Calendar size={13} /> {formattedDate}
              </span>
              <span className={styles.heroBadge}>
                <ShieldCheck size={12} />
                {currentUser.role.charAt(0).toUpperCase() + currentUser.role.slice(1)}
                {currentUser.department ? ` · ${currentUser.department}` : ''}
              </span>
            </div>
          </div>
        </div>

        <div className={styles.heroActions}>
          <Link href="/quotation" className={styles.heroPrimaryBtn}>
            <Plus size={16} strokeWidth={2.5} /> New Quotation
          </Link>
          <Link href="/leads" className={styles.heroSecondaryBtn}>
            <Contact size={15} /> Leads Hub
          </Link>
          <Link href="/analytics" className={styles.heroAnalyticsBtn}>
            <BarChart3 size={15} /> Analytics
          </Link>
        </div>
      </section>

      {/* 2. EXECUTIVE HEADLINE KPI CARDS */}
      <KpiRow
        headlineKpis={headlineKpis}
        kpis={kpis}
        pendingActions={pendingAttentionItems.length}
        loading={headlineKpis === null || kpis === null}
      />

      {/* 3. TOP DUAL/TRIPLE SPLIT GRID */}
      <div className={`${styles.topGrid} ${salesLeadership ? styles.topGridPair : ''}`}>
        {/* Needs Your Attention Hub */}
        <div className={`${styles.attentionPanel} ${styles.topGridPanel} ${urgentAttentionCount > 0 ? styles.attentionPanelUrgent : ''}`}>
          <div className={styles.attentionHead}>
            <div className={styles.attentionHeadLeft}>
              <span className={styles.attentionHeadIcon}><Zap size={16} /></span>
              <span className={styles.attentionHeadTitle}>Needs Your Attention</span>
            </div>
            {urgentAttentionCount > 0 ? (
              <span className={styles.attentionHeadBadge}>{urgentAttentionCount} urgent</span>
            ) : pendingAttentionItems.length === 0 && !attentionLoading ? (
              <span className={styles.attentionHeadClearBadge}>All Clear</span>
            ) : null}
          </div>

          {pendingAttentionItems.length > 0 ? (
            <div className={`${styles.attentionList} ${styles.attentionScroll}`}>
              {pendingAttentionItems.map((item) => (
                <AttentionRow key={item.key} item={item} />
              ))}
            </div>
          ) : (
            <div className={styles.attentionEmpty}>
              {attentionLoading ? (
                <span className={styles.attentionAllCaughtUp}>Checking active queues&hellip;</span>
              ) : (
                <div className={styles.attentionCaughtUpCard}>
                  <div className={styles.attentionCaughtUpIcon}><CheckCircle2 size={24} /></div>
                  <div className={styles.attentionCaughtUpTitle}>You&apos;re all caught up!</div>
                  <div className={styles.attentionCaughtUpSub}>No pending approvals, urgent leads, or due reminders require your attention right now.</div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sales Leadership Summary Table OR Non-leadership Insights Grid */}
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
                    <ChevronRight size={14} className={styles.attentionArrow} />
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

      {/* 4. MY TARGET PANEL (When applicable) */}
      <MyTargetPanel />

      {/* 5. PERSONAL ASSIGNMENTS HUB (When applicable) */}
      {(myAssignedProjects.length > 0 || myAssignedDemos.length > 0) && (
        <div className={styles.recentGrid}>
          <div className={styles.recentCard}>
            <div className={styles.recentCardHead}>
              <h3>Projects Assigned to You</h3>
              <Link href="/projects">View all &rarr;</Link>
            </div>
            <div className={styles.recentList}>
              {myAssignedProjects.length === 0 && <div className={styles.recentEmpty}>None right now.</div>}
              {myAssignedProjects.map((p) => (
                <Link key={p.id} href={`/projects/${p.id}`} className={styles.recentRow}>
                  <div className={styles.recentRowMain}>
                    <div className={styles.recentRowTitle}>{p.client_name || p.company || `Project ${p.id}`}</div>
                    <div className={styles.recentRowMeta}>{PROJECT_STAGE_LABEL[p.stage] || p.stage}</div>
                  </div>
                  <ChevronRight size={14} className={styles.attentionArrow} />
                </Link>
              ))}
            </div>
          </div>

          <div className={styles.recentCard}>
            <div className={styles.recentCardHead}>
              <h3>Demos Assigned to You</h3>
              <Link href="/demo-schedule">View all &rarr;</Link>
            </div>
            <div className={styles.recentList}>
              {myAssignedDemos.length === 0 && <div className={styles.recentEmpty}>None right now.</div>}
              {myAssignedDemos.map((d) => (
                <Link key={d.id} href="/demo-schedule" className={styles.recentRow}>
                  <div className={styles.recentRowMain}>
                    <div className={styles.recentRowTitle}>{d.client_name}{d.company ? ` (${d.company})` : ''}</div>
                    <div className={styles.recentRowMeta}>{d.status.replace(/_/g, ' ')}</div>
                  </div>
                  <ChevronRight size={14} className={styles.attentionArrow} />
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 6. REDESIGNED DEPARTMENT HEALTH & PERFORMANCE SECTION */}
      {health && health.gauges.length > 0 && (
        <section className={styles.healthSection} aria-label="Department Health & Performance">
          <div className={styles.healthHead}>
            <div>
              <div className={styles.healthTitleRow}>
                <span className={styles.healthIconWrapper}><Sparkles size={18} /></span>
                <h2 className={styles.healthTitle}>
                  {health.scope === 'org'
                    ? 'Department Health & Performance'
                    : health.scope === 'department'
                      ? health.gauges.length === 1
                        ? `${health.gauges[0].department} Team Health`
                        : 'Team Health'
                      : 'Your Performance Scorecard'}
                </h2>
                {healthStats && (
                  <span className={styles.healthOrgScoreBadge}>
                    Org Avg: {healthStats.avgScore}% · {healthStats.total} Teams
                  </span>
                )}
              </div>
              <p className={styles.healthSub}>
                Performance index tracking operational targets, turnaround SLAs, and deliverables. Click any card for detailed breakdowns.
              </p>
            </div>

            <div className={styles.healthControls}>
              {/* Department Search Input */}
              <div className={styles.healthSearchWrap}>
                <Search size={13} className={styles.healthSearchIcon} />
                <input
                  type="text"
                  className={styles.healthSearchInput}
                  placeholder="Filter departments..."
                  value={healthSearchQuery}
                  onChange={(e) => setHealthSearchQuery(e.target.value)}
                  aria-label="Filter departments by name"
                />
                {healthSearchQuery && (
                  <button
                    type="button"
                    className={styles.healthSearchClear}
                    onClick={() => setHealthSearchQuery('')}
                    aria-label="Clear filter"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>

              {/* Filter Pills */}
              <div className={styles.healthFilterPills}>
                <button
                  type="button"
                  className={`${styles.healthFilterBtn} ${healthBandFilter === 'all' ? styles.healthFilterBtnActive : ''}`}
                  onClick={() => setHealthBandFilter('all')}
                >
                  All ({healthStats?.total ?? 0})
                </button>
                <button
                  type="button"
                  className={`${styles.healthFilterBtn} ${healthBandFilter === 'red' ? styles.healthFilterBtnActive : ''}`}
                  onClick={() => setHealthBandFilter('red')}
                >
                  <span className={styles.healthFilterDot} style={{ background: 'var(--mx-danger)' }} />
                  Needs Attention ({healthStats?.redCount ?? 0})
                </button>
                <button
                  type="button"
                  className={`${styles.healthFilterBtn} ${healthBandFilter === 'yellow' ? styles.healthFilterBtnActive : ''}`}
                  onClick={() => setHealthBandFilter('yellow')}
                >
                  <span className={styles.healthFilterDot} style={{ background: 'var(--mx-warning)' }} />
                  On Track ({healthStats?.yellowCount ?? 0})
                </button>
                <button
                  type="button"
                  className={`${styles.healthFilterBtn} ${healthBandFilter === 'green' ? styles.healthFilterBtnActive : ''}`}
                  onClick={() => setHealthBandFilter('green')}
                >
                  <span className={styles.healthFilterDot} style={{ background: 'var(--mx-success)' }} />
                  Performing ({healthStats?.greenCount ?? 0})
                </button>
              </div>

              {/* View Mode Toggle */}
              <div className={styles.moduleViewModeToggle}>
                <button
                  type="button"
                  className={`${styles.moduleViewModeBtn} ${healthViewMode === 'cards' ? styles.moduleViewModeBtnActive : ''}`}
                  onClick={() => setHealthViewMode('cards')}
                  title="Scorecard Grid"
                >
                  <LayoutGrid size={13} /> Cards
                </button>
                <button
                  type="button"
                  className={`${styles.moduleViewModeBtn} ${healthViewMode === 'leaderboard' ? styles.moduleViewModeBtnActive : ''}`}
                  onClick={() => setHealthViewMode('leaderboard')}
                  title="Ranked Table"
                >
                  <TableIcon size={13} /> Ranked
                </button>
              </div>

              {/* Sort selector */}
              <select
                className={styles.healthSortSelect}
                value={healthSortOrder}
                onChange={(e) => setHealthSortOrder(e.target.value as 'priority' | 'top' | 'alpha')}
                aria-label="Sort health gauges"
              >
                <option value="priority">Sort: Priority (Lowest First)</option>
                <option value="top">Sort: Top Performing First</option>
                <option value="alpha">Sort: Name (A-Z)</option>
              </select>

              {/* Executive Copy Snapshot Button */}
              <button
                type="button"
                className={styles.healthSnapshotBtn}
                onClick={handleCopyHealthReport}
                title="Copy formatted Executive Health Report to clipboard"
              >
                {copiedHealthToast ? (
                  <>
                    <Check size={13} className={styles.snapshotCheckIcon} /> Copied!
                  </>
                ) : (
                  <>
                    <Copy size={13} /> Snapshot
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Executive Performance Highlights Bar */}
          {healthStats && (
            <div className={styles.healthInsightsBar}>
              <button
                type="button"
                className={`${styles.healthInsightCard} ${styles.healthInsightCardClickable}`}
                onClick={() => setHealthBandFilter('all')}
                title="View all departments"
              >
                <div className={`${styles.healthInsightIcon} ${styles.healthInsightIconAvg}`}>
                  <Activity size={18} />
                </div>
                <div className={styles.healthInsightText}>
                  <div className={styles.healthInsightVal}>{healthStats.avgScore}% Overall Health</div>
                  <div className={styles.healthInsightSub}>Across {healthStats.total} monitored departments</div>
                </div>
              </button>

              {healthStats.riskDept ? (
                <button
                  type="button"
                  className={`${styles.healthInsightCard} ${styles.healthInsightCardClickable} ${styles.healthInsightCardWarning}`}
                  onClick={() => setHealthBandFilter('red')}
                  title="Filter to departments needing attention"
                >
                  <div className={`${styles.healthInsightIcon} ${styles.healthInsightIconRisk}`}>
                    <AlertTriangle size={18} />
                  </div>
                  <div className={styles.healthInsightText}>
                    <div className={styles.healthInsightVal}>{healthStats.riskDept.department} ({healthStats.riskDept.score}%)</div>
                    <div className={styles.healthInsightSub}>Requires immediate review ({healthStats.redCount} at risk)</div>
                  </div>
                </button>
              ) : (
                <div className={styles.healthInsightCard}>
                  <div className={`${styles.healthInsightIcon} ${styles.healthInsightIconTop}`}>
                    <CheckCircle2 size={18} />
                  </div>
                  <div className={styles.healthInsightText}>
                    <div className={styles.healthInsightVal}>0 Teams At Risk</div>
                    <div className={styles.healthInsightSub}>All department targets within acceptable thresholds</div>
                  </div>
                </div>
              )}

              {healthStats.topDept && (
                <button
                  type="button"
                  className={`${styles.healthInsightCard} ${styles.healthInsightCardClickable}`}
                  onClick={() => setHealthBandFilter('green')}
                  title="Filter to top performing departments"
                >
                  <div className={`${styles.healthInsightIcon} ${styles.healthInsightIconTop}`}>
                    <Trophy size={18} />
                  </div>
                  <div className={styles.healthInsightText}>
                    <div className={styles.healthInsightVal}>{healthStats.topDept.department} ({healthStats.topDept.score}%)</div>
                    <div className={styles.healthInsightSub}>Highest operational health score</div>
                  </div>
                </button>
              )}
            </div>
          )}

          {filteredAndSortedGauges.length > 0 ? (
            healthViewMode === 'cards' ? (
              <div className={styles.healthGrid}>
                {filteredAndSortedGauges.map((g) => (
                  <HealthGauge
                    key={g.department}
                    label={g.department}
                    score={g.score}
                    band={g.band}
                    breakdown={g.breakdown}
                    managers={managersByDepartment[g.department] || []}
                    onOpen={() => setOpenHealthDepartment(g.department)}
                  />
                ))}
              </div>
            ) : (
              <div className={styles.healthLeaderboardWrap}>
                <table className={styles.healthLeaderboardTable}>
                  <thead>
                    <tr>
                      <th style={{ width: '45px' }}>Rank</th>
                      <th>Department &amp; Lead</th>
                      <th>Status Band</th>
                      <th style={{ minWidth: '180px' }}>Health Score</th>
                      <th>Primary Operational Metric</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAndSortedGauges.map((g, idx) => {
                      const deptIcon = departmentIconFor(g.department);
                      const headline = g.breakdown[0];
                      const color = BAND_COLOR[g.band];
                      const managers = managersByDepartment[g.department] || [];
                      const leadManager = managers[0];

                      return (
                        <tr key={g.department}>
                          <td>
                            <span className={`${styles.rankBadge} ${idx === 0 ? styles.rankBadgeTop : ''}`}>
                              #{idx + 1}
                            </span>
                          </td>
                          <td>
                            <div className={styles.leaderboardDeptCell}>
                              <span className={styles.leaderboardDeptIcon}>
                                {createElement(deptIcon, { size: 15 })}
                              </span>
                              <div>
                                <strong className={styles.leaderboardDeptName}>{g.department}</strong>
                                {leadManager && (
                                  <div className={styles.leaderboardManagerName}>
                                    Lead: {leadManager.name || leadManager.username}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                          <td>
                            <span className={styles.legendItem} style={{ color, borderColor: color }}>
                              <i style={{ background: color }} />
                              {BAND_TEXT[g.band]}
                            </span>
                          </td>
                          <td>
                            <div className={styles.leaderboardScoreBar}>
                              <div className={styles.leaderboardMiniTrack}>
                                <div
                                  className={styles.leaderboardMiniFill}
                                  style={{ width: `${Math.max(0, Math.min(100, g.score))}%`, background: color }}
                                />
                              </div>
                              <span className={styles.leaderboardScoreNum} style={{ color }}>
                                {g.band === 'na' ? '—' : `${g.score}%`}
                              </span>
                            </div>
                          </td>
                          <td>
                            {headline ? (
                              <span style={{ fontSize: '12px' }}>
                                {headline.label}: <strong>{headline.value}</strong>
                              </span>
                            ) : (
                              <span style={{ color: 'var(--mx-ink-faint)', fontSize: '12px' }}>No metrics recorded</span>
                            )}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <button
                              type="button"
                              className={styles.leaderboardActionBtn}
                              onClick={() => setOpenHealthDepartment(g.department)}
                            >
                              Team Details <ChevronRight size={12} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            <div className={styles.emptySearchResult}>
              {healthSearchQuery ? (
                <>No departments matching &ldquo;{healthSearchQuery}&rdquo; found.</>
              ) : (
                <>No departments found in the &ldquo;{healthBandFilter}&rdquo; status band.</>
              )}
            </div>
          )}
        </section>
      )}


      {openHealthDepartment && (
        <DepartmentHealthDetail
          department={openHealthDepartment}
          onClose={() => setOpenHealthDepartment(null)}
          myProjects={allProjects || []}
        />
      )}

      {/* 7. CELEBRATIONS SECTION */}
      <div className={styles.sectionHeading}>
        <span>🎉 Company Celebrations</span>
      </div>
      <CelebrationsSection />

      {/* 8. REDESIGNED WORKSPACE & OPERATIONAL MODULES DIRECTORY */}
      <section className={styles.modulesSection} aria-label="Workspace & System Modules">
        <div className={styles.modulesSectionHead}>
          <div className={styles.modulesHeadLeft}>
            <span className={styles.modulesHeadIconWrapper}><Layers size={18} /></span>
            <h2 className={styles.modulesTitle}>Workspace &amp; System Modules</h2>
            <span className={styles.modulesCount}>{totalModuleCount} tools</span>
          </div>

          <div className={styles.modulesHeadRight}>
            {/* View Mode Toggle */}
            <div className={styles.moduleViewModeToggle}>
              <button
                type="button"
                className={`${styles.moduleViewModeBtn} ${moduleViewMode === 'accordion' ? styles.moduleViewModeBtnActive : ''}`}
                onClick={() => setModuleViewMode('accordion')}
                title="Categorized View"
              >
                <ListFilter size={13} /> Grouped
              </button>
              <button
                type="button"
                className={`${styles.moduleViewModeBtn} ${moduleViewMode === 'grid' ? styles.moduleViewModeBtnActive : ''}`}
                onClick={() => setModuleViewMode('grid')}
                title="Expanded Grid View"
              >
                <LayoutGrid size={13} /> All Tools
              </button>
            </div>

            {/* Instant Search Bar */}
            <div className={styles.moduleSearchWrap}>
              <Search size={14} className={styles.moduleSearchIcon} />
              <input
                type="text"
                className={styles.moduleSearchInput}
                placeholder="Search tools &amp; modules…"
                value={moduleSearchQuery}
                onChange={(e) => setModuleSearchQuery(e.target.value)}
              />
              {moduleSearchQuery && (
                <button
                  type="button"
                  className={styles.moduleSearchClear}
                  onClick={() => setModuleSearchQuery('')}
                  aria-label="Clear search"
                >
                  &times;
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Quick Jump Category Chips */}
        {!moduleSearchQuery && (
          <div className={styles.categoryTabsBar}>
            {categoryList.map((catKey) => {
              const label = catKey === 'all' ? 'All Categories' : catKey;
              const isActive = selectedCategoryTab === catKey;
              const Icon = catKey === 'all' ? Layers : sectionIconFor(catKey);
              return (
                <button
                  key={catKey}
                  type="button"
                  className={`${styles.categoryTabChip} ${isActive ? styles.categoryTabChipActive : ''}`}
                  onClick={() => setSelectedCategoryTab(catKey)}
                >
                  <Icon size={13} />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Search Results Mode */}
        {filteredModules !== null ? (
          filteredModules.length > 0 ? (
            <div className={styles.searchResultsGrid}>
              {filteredModules.map((tile) => {
                const TileIcon = resolveModuleIcon(tile.icon);
                return (
                  <Link key={tile.id} href={tile.href} className={styles.searchResultCard}>
                    <div>
                      <div className={styles.searchResultCat}>{tile.category}</div>
                      <div className={styles.tileHead}>
                        {TileIcon && <span className={styles.tileIcon}><TileIcon size={18} /></span>}
                        <span className={styles.searchResultTitle}>{tile.label}</span>
                      </div>
                      <span className={styles.searchResultDesc}>{tile.desc}</span>
                    </div>
                    <div className={styles.tileFooter}>
                      <ArrowRight size={14} className={styles.tileArrow} />
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className={styles.emptySearchResult}>
              No modules found matching &ldquo;{moduleSearchQuery}&rdquo;. Try searching for &ldquo;Leads&rdquo;, &ldquo;TMS&rdquo;, &ldquo;Quotation&rdquo;, or &ldquo;HR&rdquo;.
            </div>
          )
        ) : moduleViewMode === 'grid' ? (
          /* Full Expanded Grid Mode */
          <div className={styles.searchResultsGrid}>
            {allFlattenedModules
              .filter((m) => selectedCategoryTab === 'all' || m.category === selectedCategoryTab)
              .map((tile) => {
                const TileIcon = resolveModuleIcon(tile.icon);
                return (
                  <Link key={tile.id} href={tile.href} className={styles.searchResultCard}>
                    <div>
                      <div className={styles.searchResultCat}>{tile.category}</div>
                      <div className={styles.tileHead}>
                        {TileIcon && <span className={styles.tileIcon}><TileIcon size={18} /></span>}
                        <span className={styles.searchResultTitle}>{tile.label}</span>
                      </div>
                      <span className={styles.searchResultDesc}>{tile.desc}</span>
                    </div>
                    <div className={styles.tileFooter}>
                      <ArrowRight size={14} className={styles.tileArrow} />
                    </div>
                  </Link>
                );
              })}
          </div>
        ) : (
          /* Accordion Mode */
          visibleSections.map((section) => {
            const SectionToggleIcon = sectionIconFor(section.label);
            const isCurrentlyExpanded = isExpanded(section.label);
            const categoryDescription = SECTION_DESCRIPTIONS[section.label] || 'Manage operations and department workflows';

            return (
              <Fragment key={section.label}>
                <div>
                  <button
                    type="button"
                    className={styles.sectionToggle}
                    aria-expanded={isCurrentlyExpanded}
                    onClick={() => toggle(section.label)}
                  >
                    <span className={styles.sectionToggleIcon}><SectionToggleIcon size={18} /></span>
                    <div className={styles.sectionToggleMain}>
                      <div className={styles.sectionToggleLabel}>{section.label}</div>
                      <div className={styles.sectionToggleSub}>{categoryDescription}</div>
                    </div>
                    <span className={styles.sectionToggleCount}>{section.tiles.length} {section.tiles.length === 1 ? 'tool' : 'tools'}</span>
                    <span className={styles.sectionChevron}>›</span>
                  </button>

                  {isCurrentlyExpanded && (
                    <div className={styles.grid}>
                      {section.tiles.map((tile) => {
                        const TileIcon = resolveModuleIcon(tile.icon);
                        return (
                          <Link key={tile.id} href={tile.href} className={styles.tile}>
                            <div>
                              <span className={styles.tileHead}>
                                {TileIcon && <span className={styles.tileIcon}><TileIcon size={18} /></span>}
                                <span className={styles.tileTitle}>{tile.label}</span>
                              </span>
                              <span className={styles.tileDesc}>{tile.desc}</span>
                            </div>
                            <div className={styles.tileFooter}>
                              <ArrowRight size={14} className={styles.tileArrow} />
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
                {dueAfterSection === section.label && dueSection}
              </Fragment>
            );
          })
        )}

        {dueAfterSection === null && dueSection}
      </section>
    </AppShell>
  );
}

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
        <span className={styles.sectionToggleIcon}><DUE_SECTION_ICON size={18} /></span>
        <div className={styles.sectionToggleMain}>
          <div className={styles.sectionToggleLabel}>{DUE_SECTION_LABEL}</div>
          <div className={styles.sectionToggleSub}>Clock-driven deadlines, overdue calls, and reminder queues</div>
        </div>
        <span className={styles.sectionToggleCount}>{items.length} due</span>
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

function SalesTeamSummaryPanel({ rows }: { rows: SalesTeamSummaryRow[] | null }) {
  return (
    <div className={styles.summaryCard}>
      <div className={styles.summaryHead}>
        <div>
          <h3 className={styles.summaryTitle}>Sales Team Pipeline Summary</h3>
          <div className={styles.summaryFunnelFlow}>
            <span className={styles.summaryFunnelStep}>Lead</span>
            <span className={styles.summaryFunnelArrow}>→</span>
            <span className={styles.summaryFunnelStep}>To Call</span>
            <span className={styles.summaryFunnelArrow}>→</span>
            <span className={styles.summaryFunnelStep}>Enquiry</span>
            <span className={styles.summaryFunnelArrow}>→</span>
            <span className={styles.summaryFunnelStep}>Quote</span>
            <span className={styles.summaryFunnelArrow}>→</span>
            <span className={styles.summaryFunnelStep}>Billing</span>
            <span className={styles.summaryFunnelArrow}>→</span>
            <span className={styles.summaryFunnelStep}>Outcome</span>
          </div>
        </div>
        <div className={styles.summaryHeadActions}>
          {rows !== null && rows.length > 0 && (
            <span className={styles.summaryCount}>{rows.length} {rows.length === 1 ? 'rep' : 'reps'}</span>
          )}
          <Link href="/analytics" className={styles.summaryLink}>
            Analytics <ChevronRight size={13} />
          </Link>
        </div>
      </div>
      {rows === null ? (
        <div className={styles.recentEmpty}>Loading sales pipeline data&hellip;</div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={UsersIcon}
          title="No Sales Team members yet"
          message="Add active employees to the Sales or GEM - Sales department to see their pipeline here."
        />
      ) : (
        <>
          <Table
            rows={rows}
            rowKey={(row) => row.id}
            tableClassName={styles.summaryTable}
            wrapClassName={styles.summaryViewport}
            columns={[
              {
                key: 'name',
                header: 'Rep Name',
                render: (row: SalesTeamSummaryRow) => (
                  <div className={styles.summaryRepCell}>
                    <span className={styles.repAvatar}>{getInitials(row.name)}</span>
                    <span className={styles.repName}>{row.name}</span>
                  </div>
                )
              },
              { key: 'leads', header: 'Lead', headerClassName: styles.summaryNum, cellClassName: styles.summaryNum, render: (row: SalesTeamSummaryRow) => row.leads },
              {
                key: 'toCall',
                header: 'To Call',
                headerClassName: styles.summaryNum,
                cellClassName: styles.summaryNum,
                render: (row: SalesTeamSummaryRow) => (row.toCall ? row.toCall : '\u2014')
              },
              {
                key: 'unattended',
                header: 'Unattended',
                headerClassName: styles.summaryNum,
                cellClassName: styles.summaryNum,
                render: (row: SalesTeamSummaryRow) =>
                  row.unattended ? <span className={styles.summaryAlertBadge}>{row.unattended}</span> : '\u2014'
              },
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
                    '\u2014'
                  )
              }
            ]}
          />
          <div className={styles.summaryTotals}>
            <span className={styles.summaryTotalsLabel}>Team Aggregate:</span>
            <span className={styles.summaryTotalItem}>{rows.reduce((sum, r) => sum + r.leads, 0)} Leads</span>
            <span>&bull;</span>
            <span className={styles.summaryTotalItem}>{rows.reduce((sum, r) => sum + r.quotations, 0)} Quotes</span>
            <span>&bull;</span>
            <span className={styles.summaryTotalItem}>{formatMoney(rows.reduce((sum, r) => sum + r.billing, 0))}</span>
            {rows.reduce((sum, r) => sum + r.unattended, 0) > 0 && (
              <span className={styles.summaryTotalsAlert}>
                {rows.reduce((sum, r) => sum + r.unattended, 0)} Unattended Leads
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function AttentionRow({ item, onNavigate }: { item: AttentionItem; onNavigate?: () => void }) {
  const ItemIcon = ATTENTION_ICON[item.key] || ListChecks;
  return (
    <Link
      href={item.href}
      className={`${styles.attentionRow} ${item.tone === 'urgent' ? styles.attentionUrgent : ''}`}
      onClick={onNavigate}
    >
      <span className={styles.attentionIcon}><ItemIcon size={16} /></span>
      <span className={styles.attentionLabel}>{item.label}</span>
      <span className={styles.attentionCount}>{item.count}</span>
      <ChevronRight size={15} className={styles.attentionArrow} aria-hidden />
    </Link>
  );
}

function KpiRow({
  headlineKpis,
  kpis,
  pendingActions,
  loading
}: {
  headlineKpis: HeadlineKpis | null;
  kpis: Kpis | null;
  pendingActions: number;
  loading: boolean;
}) {
  const cards = [
    {
      key: 'leads',
      type: 'leads',
      icon: Contact,
      label: 'Total Leads',
      value: headlineKpis ? headlineKpis.totalLeads.toLocaleString('en-IN') : '—',
      href: '/leads'
    },
    {
      key: 'projects',
      type: 'projects',
      icon: Briefcase,
      label: 'Active Projects',
      value: kpis ? kpis.activeProjects.toLocaleString('en-IN') : '—',
      href: '/projects'
    },
    {
      key: 'value',
      type: 'value',
      icon: IndianRupee,
      label: 'Pipeline Value',
      value: headlineKpis ? formatMoney(headlineKpis.totalQuotationValue) : '—',
      href: '/my-quotations'
    },
    {
      key: 'pending',
      type: pendingActions > 0 ? 'pending' : 'clear',
      icon: pendingActions > 0 ? ListChecks : CheckCircle2,
      label: 'Pending Actions',
      value: String(pendingActions),
      href: '/',
      alert: pendingActions > 0,
      clear: pendingActions === 0
    }
  ];

  return (
    <div className={styles.kpiRow}>
      {cards.map((card) => {
        const Icon = card.icon;
        const iconWrapperClass =
          card.type === 'leads'
            ? styles.kpiIconWrapperLeads
            : card.type === 'projects'
              ? styles.kpiIconWrapperProjects
              : card.type === 'value'
                ? styles.kpiIconWrapperValue
                : card.alert
                  ? styles.kpiIconWrapperPending
                  : styles.kpiIconWrapperSuccess;

        const body = (
          <>
            <div className={styles.kpiCardHead}>
              <span className={`${styles.kpiIconWrapper} ${iconWrapperClass}`}>
                <Icon size={17} strokeWidth={2.2} />
              </span>
              {card.alert ? (
                <span className={styles.kpiTagAlert}>Urgent</span>
              ) : card.clear ? (
                <span className={styles.kpiTagSuccess}>All Clear</span>
              ) : (
                <ArrowRight size={14} className={styles.kpiHoverArrow} />
              )}
            </div>

            <div className={styles.kpiBody}>
              <div
                className={`${styles.kpiValueNew} ${loading ? styles.kpiValueLoading : ''} ${
                  card.alert ? styles.kpiValueAlert : ''
                }`}
              >
                {card.value}
              </div>
              <div className={styles.kpiLabelNew}>{card.label}</div>
            </div>
          </>
        );

        return card.key === 'pending' ? (
          <div key={card.key} className={styles.kpiCardNew}>{body}</div>
        ) : (
          <Link key={card.key} href={card.href} className={styles.kpiCardNew}>
            {body}
          </Link>
        );
      })}
    </div>
  );
}
