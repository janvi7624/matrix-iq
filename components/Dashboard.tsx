'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { QuotationRecord, SiteVisitRecord, UserRole } from '@/lib/types';
import { needsFollowUp } from '@/lib/followUp';
import { isReminderDue } from '@/lib/siteVisitReminder';
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
}

const TILES: Tile[] = [
  { title: 'Project Dashboard', desc: 'Every sales project — site visit to close — with a full pipeline timeline.', href: '/projects' },
  { title: 'Quotation', desc: 'Create a new quotation — AV, Robotics, AI Video Analytics, System Integration & VisitIQ VMS.', href: '/quotation' },
  { title: 'Site Visit Report', desc: 'Register a visit and keep logging project updates over time.', href: '/site-visits' },
  { title: 'CRM', desc: 'Track leads, prospects, and customers.', href: '/crm' },
  { title: 'Demo Schedule', desc: 'Request and approve product demos.', href: '/demo-schedule' },
  { title: 'Travel Schedule', desc: 'Log rep travel for client visits.', href: '/travel-schedule' }
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

export default function Dashboard({ currentUser }: DashboardProps) {
  const [followUpCount, setFollowUpCount] = useState<number | null>(null);
  const [reminderCount, setReminderCount] = useState<number | null>(null);
  const [kpis, setKpis] = useState<Kpis | null>(null);

  const isPrivileged = currentUser.role === 'admin' || currentUser.role === 'superadmin' || currentUser.role === 'manager';

  useEffect(() => {
    fetch('/api/projects/kpis')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Kpis | null) => setKpis(data))
      .catch(() => setKpis(null));
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
      <PortalHeader title="NANTA Sales Portal" subtitle="Quotation, site visits, CRM, demos, and travel — all in one place." />
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

        {kpis && (
          <div className={styles.kpiGrid}>
            {KPI_LABELS.map((k) => (
              <div key={k.key} className={styles.kpiCard}>
                <div className={styles.kpiValue}>{kpis[k.key]}{k.suffix || ''}</div>
                <div className={styles.kpiLabel}>{k.label}</div>
              </div>
            ))}
          </div>
        )}

        <div className={styles.grid}>
          {TILES.map((tile) => (
            <Link key={tile.title} href={tile.href} className={styles.tile}>
              <span className={styles.tileTitle}>{tile.title}</span>
              <span className={styles.tileDesc}>{tile.desc}</span>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
