'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { QuotationRecord, SiteVisitRecord, UserRole } from '@/lib/types';
import { needsFollowUp } from '@/lib/followUp';
import { isReminderDue } from '@/lib/siteVisitReminder';
import { BRAND } from '@/lib/branding';
import PortalHeader from './PortalHeader';
import styles from './dashboard.module.css';
import historyStyles from './quotationHistory.module.css';

interface DashboardProps {
  currentUser: { name: string; role: UserRole };
}

interface Tile {
  title: string;
  desc: string;
  href: string;
  comingSoon?: boolean;
}

interface TileSection {
  label: string;
  tiles: Tile[];
}

const CRM_TILES: Tile[] = [
  { title: 'Project Dashboard', desc: 'Every sales project — site visit to close — with a full pipeline timeline.', href: '/projects' },
  { title: 'Quotation', desc: 'Create a new quotation — AV, Robotics, AI Video Analytics, System Integration & VisitIQ VMS.', href: '/quotation' },
  { title: 'My Quotations', desc: 'Every quotation you’ve created, with status and follow-ups.', href: '/my-quotations' },
  { title: 'Site Visit Report', desc: 'Register a visit and keep logging project updates over time.', href: '/site-visits' },
  { title: 'CRM', desc: 'Track leads, prospects, and customers.', href: '/crm' },
  { title: 'Demo Schedule', desc: 'Request and approve product demos.', href: '/demo-schedule' },
  { title: 'Travel Schedule', desc: 'Log rep travel for client visits.', href: '/travel-schedule' }
];

const BACK_OFFICE_TILE: Tile = { title: 'Back Office Operations', desc: 'Delivery Challans — prepare, dispatch, verify returns, close.', href: '/backoffice' };

const USER_MANAGEMENT_TILE: Tile = { title: 'User Management', desc: 'Create and manage login accounts, roles, and access.', href: '/admin/users' };
const ROLE_MANAGEMENT_TILE: Tile = { title: 'Role Management', desc: 'What each role can see and do across the platform.', href: '/admin/roles' };
const AUDIT_LOG_TILE: Tile = { title: 'Audit Log', desc: 'Every status-changing action across the Back Office workflow.', href: '/admin/audit-log' };

const HR_COMING_SOON: Tile[] = [
  { title: 'Employees', desc: 'Coming soon.', href: '#', comingSoon: true },
  { title: 'Attendance & Leave', desc: 'Coming soon.', href: '#', comingSoon: true },
  { title: 'Payroll', desc: 'Coming soon.', href: '#', comingSoon: true }
];
const ACCOUNTS_COMING_SOON: Tile[] = [
  { title: 'Finance & Expenses', desc: 'Coming soon.', href: '#', comingSoon: true },
  { title: 'Procurement', desc: 'Coming soon.', href: '#', comingSoon: true },
  { title: 'Inventory & Assets', desc: 'Coming soon.', href: '#', comingSoon: true }
];

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
  { key: 'draft', label: 'Draft Quotations' },
  { key: 'sent', label: 'Sent Quotations' },
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

  const isPrivileged = currentUser.role === 'admin' || currentUser.role === 'superadmin' || currentUser.role === 'manager';
  const isBackOffice = currentUser.role === 'backoffice' || isPrivileged;
  const isSales = currentUser.role === 'user';
  const isManagerTier = currentUser.role === 'manager' || currentUser.role === 'admin' || currentUser.role === 'superadmin';

  const operationsTiles = isBackOffice ? [BACK_OFFICE_TILE] : [];
  const administrationTiles = isPrivileged ? [USER_MANAGEMENT_TILE, ROLE_MANAGEMENT_TILE, AUDIT_LOG_TILE] : [];

  const sections: TileSection[] = [
    { label: 'CRM', tiles: CRM_TILES },
    ...(operationsTiles.length ? [{ label: 'Operations', tiles: operationsTiles }] : []),
    ...(isPrivileged ? [{ label: 'Human Resources', tiles: HR_COMING_SOON }, { label: 'Accounts', tiles: ACCOUNTS_COMING_SOON }] : []),
    ...(administrationTiles.length ? [{ label: 'Administration', tiles: administrationTiles }] : [])
  ];

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

  return (
    <div className={historyStyles.body}>
      <PortalHeader title={BRAND.appName} subtitle={BRAND.tagline} />
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
              {section.tiles.map((tile) =>
                tile.comingSoon ? (
                  <div key={tile.title} className={`${styles.tile} ${historyStyles.comingSoonTile}`}>
                    <span className={styles.tileTitle}>{tile.title}</span>
                    <span className={styles.tileDesc}>{tile.desc}</span>
                  </div>
                ) : (
                  <Link key={tile.title} href={tile.href} className={styles.tile}>
                    <span className={styles.tileTitle}>{tile.title}</span>
                    <span className={styles.tileDesc}>{tile.desc}</span>
                  </Link>
                )
              )}
            </div>
          </div>
        ))}
      </main>
    </div>
  );
}
