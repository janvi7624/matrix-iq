'use client';

import { useEffect, useState } from 'react';
import { UserRole } from '@/lib/types';
import AppShell from './AppShell';
import styles from './dashboard.module.css';

interface AnalyticsViewProps {
  currentUser: { role: UserRole };
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

export default function AnalyticsView({ currentUser }: AnalyticsViewProps) {
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [quotationStats, setQuotationStats] = useState<QuotationStats | null>(null);
  const [backOfficeKpis, setBackOfficeKpis] = useState<BackOfficeKpis | null>(null);

  const isPrivileged = currentUser.role === 'admin' || currentUser.role === 'superadmin' || currentUser.role === 'manager';
  const isBackOffice = currentUser.role === 'backoffice' || isPrivileged;
  const isSales = currentUser.role === 'user';
  const isManagerTier = currentUser.role === 'manager' || currentUser.role === 'admin' || currentUser.role === 'superadmin';

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

  return (
    <AppShell title="Analytics" subtitle="Quotation, project, and pipeline performance at a glance.">
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

      {!quotationStats && !kpis && !backOfficeKpis && <div className={styles.greeting}>Loading analytics…</div>}
    </AppShell>
  );
}
