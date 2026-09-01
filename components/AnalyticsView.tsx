'use client';

import { useEffect, useMemo, useState } from 'react';
import { TmsBomRequestRecord, TmsProcurementRecord, TmsProjectRecord, TmsTaskRecord, UserRole } from '@/lib/types';
import { TMS_ROLE_KEYS } from '@/lib/tmsConstants';
import AppShell from './AppShell';
import styles from './dashboard.module.css';
import calcStyles from './calculator.module.css';
import analyticsStyles from './analyticsView.module.css';

interface AnalyticsViewProps {
  currentUser: { role: UserRole; isPrivileged: boolean };
}

interface QuotationStats {
  total: number;
  draft: number;
  sent: number;
  approved: number;
  rejected: number;
  expired: number;
}

const QUOTATION_STAT_LABELS: { key: keyof QuotationStats; label: string }[] = [
  { key: 'total', label: 'Total Quotations' },
  { key: 'approved', label: 'Approved Quotations' },
  { key: 'rejected', label: 'Rejected Quotations' },
  { key: 'expired', label: 'Expired Quotations' }
];

interface Kpis {
  totalProjects: number;
  siteVisitsToday: number;
  quotationsSent: number;
  upcomingDemos: number;
  pendingResponses: number;
  negotiations: number;
  wonDeals: number;
  lostDeals: number;
  conversionRate: number;
  upcomingSiteVisits: number;
  pendingApprovals: number;
  activeProjects: number;
}

const KPI_LABELS: { key: keyof Kpis; label: string; suffix?: string }[] = [
  { key: 'totalProjects', label: 'Total Projects' },
  { key: 'siteVisitsToday', label: 'Site Visits Today' },
  { key: 'quotationsSent', label: 'Quotations Sent' },
  { key: 'upcomingDemos', label: 'Upcoming Demos' },
  { key: 'pendingResponses', label: 'Pending Responses' },
  { key: 'negotiations', label: 'Negotiations' },
  { key: 'wonDeals', label: 'Won Deals' },
  { key: 'lostDeals', label: 'Lost Deals' },
  { key: 'conversionRate', label: 'Conversion Rate', suffix: '%' }
];

const SALES_KPI_LABELS: { key: keyof Kpis; label: string }[] = [
  { key: 'upcomingSiteVisits', label: 'Upcoming Site Visits' }
];

const MANAGER_KPI_LABELS: { key: keyof Kpis; label: string }[] = [
  { key: 'pendingApprovals', label: 'Pending Approvals' },
  { key: 'activeProjects', label: 'Active Projects' }
];

interface BackOfficeKpis {
  pendingDc: number;
  materialsOut: number;
  materialsReturned: number;
  damagedMaterials: number;
  pendingVerification: number;
  todaysDispatch: number;
}

const BACK_OFFICE_KPI_LABELS: { key: keyof BackOfficeKpis; label: string }[] = [
  { key: 'pendingDc', label: 'Pending DC' },
  { key: 'materialsOut', label: 'Materials Out' },
  { key: 'materialsReturned', label: 'Materials Returned' },
  { key: 'damagedMaterials', label: 'Damaged Materials' },
  { key: 'pendingVerification', label: 'Pending Verification' },
  { key: 'todaysDispatch', label: "Today's Dispatch" }
];

// Raw lists from /api/tms/dashboard (same shape TmsDashboardView already
// consumes) — summarized here into KPI cards rather than fetching/computing
// counts a second way, so this can never drift from the TMS Dashboard's own
// numbers.
interface TmsDashboardResponse {
  projects: TmsProjectRecord[];
  tasks: TmsTaskRecord[];
  bomRequests: TmsBomRequestRecord[];
  procurements: TmsProcurementRecord[];
}

const OPEN_TASK_STATUSES = new Set(['to_do', 'in_progress', 'on_hold']);
const OPEN_BOM_STATUSES = new Set(['draft', 'submitted', 'under_review', 'approved', 'admin_approved', 'finance_approved', 'sent_for_procurement']);

function summarizeTechnical(data: TmsDashboardResponse) {
  const now = Date.now();
  return {
    activeProjects: data.projects.filter((p) => p.status === 'in_progress' || p.status === 'not_started' || p.status === 'planning').length,
    openTasks: data.tasks.filter((t) => OPEN_TASK_STATUSES.has(t.status)).length,
    overdueTasks: data.tasks.filter((t) => OPEN_TASK_STATUSES.has(t.status) && t.due_date && new Date(t.due_date).getTime() < now).length,
    pendingBomApprovals: data.bomRequests.filter((b) => OPEN_BOM_STATUSES.has(b.status)).length,
    pendingProcurement: data.procurements.filter((p) => p.delivery_status !== 'received' && p.delivery_status !== 'cancelled').length
  };
}

type TechnicalKpis = ReturnType<typeof summarizeTechnical>;

const TECHNICAL_KPI_LABELS: { key: keyof TechnicalKpis; label: string }[] = [
  { key: 'activeProjects', label: 'Active TMS Projects' },
  { key: 'openTasks', label: 'Open Tasks' },
  { key: 'overdueTasks', label: 'Overdue Tasks' },
  { key: 'pendingBomApprovals', label: 'Pending BOM Approvals' },
  { key: 'pendingProcurement', label: 'Pending Procurement' }
];

interface MetaLeadAnalyticsBucket {
  key: string;
  label: string;
  count: number;
}

interface MetaLeadAnalytics {
  total: number;
  byPlatform: MetaLeadAnalyticsBucket[];
  byCampaign: MetaLeadAnalyticsBucket[];
  byForm: MetaLeadAnalyticsBucket[];
  byStatus: MetaLeadAnalyticsBucket[];
  byAssignedUser: MetaLeadAnalyticsBucket[];
  convertedToProject: number;
}

function BreakdownList({ title, buckets }: { title: string; buckets: MetaLeadAnalyticsBucket[] }) {
  if (!buckets.length) return null;
  return (
    <div className={analyticsStyles.breakdownCol}>
      <div className={analyticsStyles.breakdownTitle}>{title}</div>
      <div className={analyticsStyles.breakdownList}>
        {buckets.slice(0, 6).map((b) => (
          <div key={b.key} className={analyticsStyles.breakdownRow}>
            <span>{b.label}</span>
            <span className={analyticsStyles.breakdownCount}>{b.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface MarketingStats {
  isReviewer: boolean;
  isTechnical: boolean;
  awaitingReview: number;
  awaitingMarketing: number;
  pendingTechnical: number;
  readyForDelivery: number;
  myPendingTechnical: number;
  myOpenCount: number;
}

// Which cards to show depends on the viewer's own relationship to the
// pipeline (reviewer sees the review queue, everyone sees their own open
// requests) — same distinction /api/marketing-requests/stats itself draws.
function marketingKpiLabels(stats: MarketingStats): { key: keyof MarketingStats; label: string }[] {
  const labels: { key: keyof MarketingStats; label: string }[] = [{ key: 'myOpenCount', label: 'My Open Requests' }];
  if (stats.isReviewer) labels.push({ key: 'awaitingReview', label: 'Awaiting Review' }, { key: 'awaitingMarketing', label: 'In Marketing' });
  labels.push({ key: 'readyForDelivery', label: 'Ready for Delivery' });
  if (stats.isTechnical) labels.push({ key: 'myPendingTechnical', label: 'Awaiting My Technical Review' });
  else labels.push({ key: 'pendingTechnical', label: 'Awaiting Technical Review' });
  return labels;
}

export default function AnalyticsView({ currentUser }: AnalyticsViewProps) {
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [quotationStats, setQuotationStats] = useState<QuotationStats | null>(null);
  const [backOfficeKpis, setBackOfficeKpis] = useState<BackOfficeKpis | null>(null);
  const [tmsData, setTmsData] = useState<TmsDashboardResponse | null>(null);
  const [marketingStats, setMarketingStats] = useState<MarketingStats | null>(null);
  const [metaLeadAnalytics, setMetaLeadAnalytics] = useState<MetaLeadAnalytics | null>(null);

  // Role Management's isPrivileged flag, resolved server-side — NOT
  // re-derived from role name here, since an admin can toggle a role's
  // privileged status independently of what the role is called.
  const isPrivileged = currentUser.isPrivileged;
  const isBackOffice = currentUser.role === 'backoffice' || isPrivileged;
  const isSales = currentUser.role === 'user';
  // Technical department (TMS) — any of its roles, or a privileged viewer
  // overseeing everything, same "privileged sees every department's numbers"
  // convention the rest of this page already follows for Sales/Back Office.
  const isTechnical = (TMS_ROLE_KEYS as readonly string[]).includes(currentUser.role) || isPrivileged;
  const isMarketing = currentUser.role === 'marketing' || isPrivileged;

  // Sales & Back Office analytics are unchanged from before — same three
  // fetches, same endpoints, same shapes.
  useEffect(() => {
    fetch('/api/projects/kpis')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Kpis | null) => setKpis(data))
      .catch(() => setKpis(null));
  }, []);

  useEffect(() => {
    if (!isBackOffice) return;
    fetch('/api/backoffice/kpis')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: BackOfficeKpis | null) => setBackOfficeKpis(data))
      .catch(() => setBackOfficeKpis(null));
  }, [isBackOffice]);

  useEffect(() => {
    fetch('/api/quotations/stats')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: QuotationStats | null) => setQuotationStats(data))
      .catch(() => setQuotationStats(null));
  }, []);

  // Technical — reuses the same /api/tms/dashboard the full TMS Dashboard
  // page already calls, summarized into KPI cards below.
  useEffect(() => {
    if (!isTechnical) return;
    fetch('/api/tms/dashboard')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: TmsDashboardResponse | null) => setTmsData(data))
      .catch(() => setTmsData(null));
  }, [isTechnical]);

  // Marketing — reuses the existing marketing-requests stats endpoint.
  useEffect(() => {
    if (!isMarketing) return;
    fetch('/api/marketing-requests/stats')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: MarketingStats | null) => setMarketingStats(data))
      .catch(() => setMarketingStats(null));
  }, [isMarketing]);

  // Meta Lead Ads — everyone who can already see leads (every role reaches
  // /leads) gets this breakdown; it's just a summarized view of records
  // already visible to them via the normal department-scoped lead list.
  useEffect(() => {
    fetch('/api/leads/meta-analytics')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: MetaLeadAnalytics | null) => setMetaLeadAnalytics(data))
      .catch(() => setMetaLeadAnalytics(null));
  }, []);

  const technicalKpis = useMemo(() => (tmsData ? summarizeTechnical(tmsData) : null), [tmsData]);

  const nothingLoadedYet = !quotationStats && !kpis && !backOfficeKpis && !technicalKpis && !marketingStats && !metaLeadAnalytics;

  return (
    <AppShell title="Analytics" subtitle="Quotation, project, and pipeline performance at a glance.">
      {(quotationStats || kpis) && <h2 className={calcStyles.h2}>Sales &amp; Pipeline</h2>}
      {quotationStats && (
        <div className={styles.kpiGrid}>
          {QUOTATION_STAT_LABELS.map((s) => (
            <div key={s.key} className={styles.kpiCard}>
              <div className={styles.kpiValue}>{quotationStats[s.key]}</div>
              <div className={styles.kpiLabel}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {kpis && (
        <div className={styles.kpiGrid}>
          {KPI_LABELS.map((k) => (
            <div key={k.key} className={styles.kpiCard}>
              <div className={styles.kpiValue}>{kpis[k.key]}{k.suffix || ''}</div>
              <div className={styles.kpiLabel}>{k.label}</div>
            </div>
          ))}
          {isSales && SALES_KPI_LABELS.map((k) => (
            <div key={k.key} className={styles.kpiCard}>
              <div className={styles.kpiValue}>{kpis[k.key]}</div>
              <div className={styles.kpiLabel}>{k.label}</div>
            </div>
          ))}
          {isPrivileged && MANAGER_KPI_LABELS.map((k) => (
            <div key={k.key} className={styles.kpiCard}>
              <div className={styles.kpiValue}>{kpis[k.key]}</div>
              <div className={styles.kpiLabel}>{k.label}</div>
            </div>
          ))}
        </div>
      )}

      {backOfficeKpis && (
        <>
          <h2 className={calcStyles.h2}>Back Office</h2>
          <div className={styles.kpiGrid}>
            {BACK_OFFICE_KPI_LABELS.map((k) => (
              <div key={k.key} className={styles.kpiCard}>
                <div className={styles.kpiValue}>{backOfficeKpis[k.key]}</div>
                <div className={styles.kpiLabel}>{k.label}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {technicalKpis && (
        <>
          <h2 className={calcStyles.h2}>Technical</h2>
          <div className={styles.kpiGrid}>
            {TECHNICAL_KPI_LABELS.map((k) => (
              <div key={k.key} className={styles.kpiCard}>
                <div className={styles.kpiValue}>{technicalKpis[k.key]}</div>
                <div className={styles.kpiLabel}>{k.label}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {marketingStats && (
        <>
          <h2 className={calcStyles.h2}>Marketing</h2>
          <div className={styles.kpiGrid}>
            {marketingKpiLabels(marketingStats).map((k) => (
              <div key={k.key} className={styles.kpiCard}>
                <div className={styles.kpiValue}>{marketingStats[k.key]}</div>
                <div className={styles.kpiLabel}>{k.label}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {metaLeadAnalytics && metaLeadAnalytics.total > 0 && (
        <>
          <h2 className={calcStyles.h2}>Meta Lead Ads</h2>
          <div className={styles.kpiGrid}>
            <div className={styles.kpiCard}>
              <div className={styles.kpiValue}>{metaLeadAnalytics.total}</div>
              <div className={styles.kpiLabel}>Total Meta Leads</div>
            </div>
            <div className={styles.kpiCard}>
              <div className={styles.kpiValue}>{metaLeadAnalytics.convertedToProject}</div>
              <div className={styles.kpiLabel}>Converted to Project</div>
            </div>
          </div>
          <div className={`${calcStyles.sectionPanel} ${analyticsStyles.breakdownWrap}`}>
            <BreakdownList title="By Campaign" buckets={metaLeadAnalytics.byCampaign} />
            <BreakdownList title="By Form" buckets={metaLeadAnalytics.byForm} />
            <BreakdownList title="By Platform" buckets={metaLeadAnalytics.byPlatform} />
            <BreakdownList title="By Status" buckets={metaLeadAnalytics.byStatus} />
            <BreakdownList title="By Assigned Sales Person" buckets={metaLeadAnalytics.byAssignedUser} />
          </div>
        </>
      )}

      {nothingLoadedYet && <div className={styles.greeting}>Loading analytics…</div>}
    </AppShell>
  );
}
