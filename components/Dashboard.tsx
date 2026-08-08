'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ModuleConfigRecord, ProjectRecord, QuotationRecord, SiteVisitRecord, UserRole } from '@/lib/types';
import { STAGE_LABEL as PROJECT_STAGE_LABEL } from '@/lib/projectStages';
import { formatMoney } from '@/lib/format';
import { needsFollowUp } from '@/lib/followUp';
import { isReminderDue } from '@/lib/siteVisitReminder';
import AppShell from './AppShell';
import { BRAND } from '@/lib/branding';
import styles from './dashboard.module.css';
import historyStyles from './quotationHistory.module.css';

interface DashboardProps {
  currentUser: { name: string; role: UserRole };
}

// Only the fields the two banners below still need — the full KPI grids
// (quotation stats, pipeline KPIs, Back Office KPIs) moved to /analytics
// (components/AnalyticsView.tsx) so the Dashboard stays focused on
// navigation instead of a long stack of number boxes.
interface Kpis {
  pendingApprovals: number;
}

interface BackOfficeKpis {
  pendingDc: number;
  pendingVerification: number;
}

export default function Dashboard({ currentUser }: DashboardProps) {
  const [followUpCount, setFollowUpCount] = useState<number | null>(null);
  const [reminderCount, setReminderCount] = useState<number | null>(null);
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [backOfficeKpis, setBackOfficeKpis] = useState<BackOfficeKpis | null>(null);
  const [modules, setModules] = useState<ModuleConfigRecord[] | null>(null);
  const [unattendedLeads, setUnattendedLeads] = useState<number | null>(null);
  const [marketingStats, setMarketingStats] = useState<{ isReviewer: boolean; awaitingReview?: number; myOpenCount?: number } | null>(null);
  const [recentProjects, setRecentProjects] = useState<ProjectRecord[] | null>(null);
  const [recentQuotations, setRecentQuotations] = useState<QuotationRecord[] | null>(null);

  const isPrivileged = currentUser.role === 'admin' || currentUser.role === 'superadmin' || currentUser.role === 'manager';
  const isBackOffice = currentUser.role === 'backoffice' || isPrivileged;
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

  // Launchpad: "where do I need to go next" — most recently touched
  // projects/quotations, reusing the same endpoints Projects/My Quotations
  // already fetch (own-vs-org-wide scoping already handled server-side).
  useEffect(() => {
    fetch('/api/projects')
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: ProjectRecord[]) => setRecentProjects([...rows].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)).slice(0, 5)))
      .catch(() => setRecentProjects([]));
  }, []);

  useEffect(() => {
    fetch('/api/quotations/mine')
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: QuotationRecord[]) => setRecentQuotations([...rows].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 5)))
      .catch(() => setRecentQuotations([]));
  }, []);

  return (
    <AppShell title={BRAND.appName} subtitle={BRAND.tagline} showBackLink={false}>
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
          <div className={styles.kpiValue}>📈</div>
          <div className={styles.kpiLabel}>View Full Analytics &rarr;</div>
        </Link>
      </div>

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
    </AppShell>
  );
}
