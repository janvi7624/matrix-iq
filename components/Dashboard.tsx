'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ModuleConfigRecord, QuotationRecord, SiteVisitRecord, UserRole } from '@/lib/types';
import { needsFollowUp } from '@/lib/followUp';
import { isReminderDue } from '@/lib/siteVisitReminder';
import { BRAND } from '@/lib/branding';
import PortalHeader from './PortalHeader';
import styles from './dashboard.module.css';
import historyStyles from './quotationHistory.module.css';

interface DashboardProps {
  currentUser: { name: string; role: UserRole };
}

interface QuotationStats {
  total: number;
  draft: number;
  sent: number;
  approved: number;
  rejected: number;
  expired: number;
}

// "Draft"/"Sent" cards were removed from the Dashboard (section 23) — kept
// on QuotationStats/the API response since Quotation History still uses
// those counts, just no longer rendered as Dashboard tiles here.
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

// Sales dashboard extras (spec section 13) — Upcoming Demos/Won/Lost Projects
// are already in the main KPI grid above, so only the sales-specific ones live here.
const SALES_KPI_LABELS: { key: keyof Kpis; label: string }[] = [
  { key: 'upcomingSiteVisits', label: 'Upcoming Site Visits' }
];

// Manager dashboard extras — Upcoming Demos/Active Projects/Conversion Rate
// are already in the main grid.
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

export default function Dashboard({ currentUser }: DashboardProps) {
  const [followUpCount, setFollowUpCount] = useState<number | null>(null);
  const [reminderCount, setReminderCount] = useState<number | null>(null);
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [quotationStats, setQuotationStats] = useState<QuotationStats | null>(null);
  const [backOfficeKpis, setBackOfficeKpis] = useState<BackOfficeKpis | null>(null);
  const [modules, setModules] = useState<ModuleConfigRecord[] | null>(null);
  const [unattendedLeads, setUnattendedLeads] = useState<number | null>(null);
  const [marketingStats, setMarketingStats] = useState<{ isReviewer: boolean; awaitingReview?: number; myOpenCount?: number } | null>(null);

  const isPrivileged = currentUser.role === 'admin' || currentUser.role === 'superadmin' || currentUser.role === 'manager';
  const isBackOffice = currentUser.role === 'backoffice' || isPrivileged;
  const isSales = currentUser.role === 'user';
  const isManagerTier = currentUser.role === 'manager' || currentUser.role === 'admin' || currentUser.role === 'superadmin';

  // Tiles are entirely config-driven now (Module Manager, /admin/modules) —
  // enable/disable/rename/reorder/re-section a module without a code change.
  const sections = useMemo(() => {
    const groups = new Map<string, ModuleConfigRecord[]>();
    (modules || []).forEach((m) => {
      const list = groups.get(m.section) || [];
      list.push(m);
      groups.set(m.section, list);
    });
    return [...groups.entries()].map(([label, tiles]) => ({ label, tiles: tiles.sort((a, b) => a.order - b.order) }));
  }, [modules]);

  useEffect(() => {
    fetch('/api/modules')
      .then((r) => (r.ok ? r.json() : []))
      .then((data: ModuleConfigRecord[]) => setModules(data))
      .catch(() => setModules([]));
  }, []);

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

  useEffect(() => {
    if (!isPrivileged) return;
    fetch('/api/admin/quotations')
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: QuotationRecord[]) => setFollowUpCount(rows.filter((r) => needsFollowUp(r)).length))
      .catch(() => setFollowUpCount(null));
  }, [isPrivileged]);

  useEffect(() => {
    fetch('/api/site-visits')
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: SiteVisitRecord[]) => setReminderCount(rows.filter((r) => isReminderDue(r)).length))
      .catch(() => setReminderCount(null));
  }, []);

  // Sales sees only their own unattended leads, Manager/Admin/Superadmin see
  // the org-wide count — same own-vs-privileged scoping every other module
  // uses, enforced server-side in computeLeadStats.
  useEffect(() => {
    fetch('/api/leads/stats')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { unattended: number } | null) => setUnattendedLeads(data ? data.unattended : null))
      .catch(() => setUnattendedLeads(null));
  }, []);

  useEffect(() => {
    fetch('/api/marketing-requests/stats')
      .then((r) => (r.ok ? r.json() : null))
      .then(setMarketingStats)
      .catch(() => setMarketingStats(null));
  }, []);

  return (
    <div className={historyStyles.body}>
      <PortalHeader title={BRAND.appName} subtitle={BRAND.tagline} showBackLink={false} />
      <main className={historyStyles.main}>
        <div className={styles.greeting}>Welcome back, {currentUser.name}.</div>

        {isPrivileged && followUpCount !== null && followUpCount > 0 && (
          <div className={styles.followUpBanner}>
            <span>
              {followUpCount} quotation{followUpCount === 1 ? '' : 's'} need{followUpCount === 1 ? 's' : ''} a follow-up.
            </span>
            <Link href="/quotation-history">Review now &rarr;</Link>
          </div>
        )}

        {reminderCount !== null && reminderCount > 0 && (
          <div className={styles.followUpBanner}>
            <span>
              {reminderCount} site visit reminder{reminderCount === 1 ? '' : 's'} due.
            </span>
            <Link href="/site-visits?focus=open">Review now &rarr;</Link>
          </div>
        )}

        {(currentUser.role === 'technical' || isManagerTier) && kpis && kpis.pendingApprovals > 0 && (
          <div className={styles.followUpBanner}>
            <span>
              {kpis.pendingApprovals} demo request{kpis.pendingApprovals === 1 ? '' : 's'} awaiting approval.
            </span>
            <Link href="/demo-schedule">Review now &rarr;</Link>
          </div>
        )}

        {isBackOffice && backOfficeKpis && (backOfficeKpis.pendingDc > 0 || backOfficeKpis.pendingVerification > 0) && (
          <div className={styles.followUpBanner}>
            <span>
              {backOfficeKpis.pendingDc > 0 && `${backOfficeKpis.pendingDc} demo${backOfficeKpis.pendingDc === 1 ? '' : 's'} awaiting a Delivery Challan. `}
              {backOfficeKpis.pendingVerification > 0 && `${backOfficeKpis.pendingVerification} DC${backOfficeKpis.pendingVerification === 1 ? '' : 's'} awaiting material return verification.`}
            </span>
            <Link href="/backoffice">Review now &rarr;</Link>
          </div>
        )}

        {unattendedLeads !== null && (
          <div className={styles.kpiGrid}>
            <Link href="/leads?filter=unattended" className={`${styles.kpiCard} ${styles.kpiCardAlert}`}>
              <div className={styles.kpiValue}>🚨 {unattendedLeads}</div>
              <div className={styles.kpiLabel}>Unattended Leads</div>
            </Link>
          </div>
        )}

        {marketingStats?.isReviewer && !!marketingStats.awaitingReview && (
          <div className={styles.kpiGrid}>
            <Link href="/marketing-requests?filter=submitted" className={`${styles.kpiCard} ${styles.kpiCardAlert}`}>
              <div className={styles.kpiValue}>📣 {marketingStats.awaitingReview}</div>
              <div className={styles.kpiLabel}>Marketing Tickets Awaiting Review</div>
            </Link>
          </div>
        )}

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
            {isManagerTier && MANAGER_KPI_LABELS.map((k) => (
              <div key={k.key} className={styles.kpiCard}>
                <div className={styles.kpiValue}>{kpis[k.key]}</div>
                <div className={styles.kpiLabel}>{k.label}</div>
              </div>
            ))}
          </div>
        )}

        {backOfficeKpis && (
          <div className={styles.kpiGrid}>
            {BACK_OFFICE_KPI_LABELS.map((k) => (
              <div key={k.key} className={styles.kpiCard}>
                <div className={styles.kpiValue}>{backOfficeKpis[k.key]}</div>
                <div className={styles.kpiLabel}>{k.label}</div>
              </div>
            ))}
          </div>
        )}

        {sections.map((section) => (
          <div key={section.label}>
            <div className={historyStyles.navGroupLabel}>{section.label}</div>
            <div className={styles.grid}>
              {section.tiles.map((tile) => (
                <Link key={tile.id} href={tile.href} className={styles.tile}>
                  <span className={styles.tileTitle}>{tile.label}</span>
                  <span className={styles.tileDesc}>{tile.desc}</span>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </main>
    </div>
  );
}
