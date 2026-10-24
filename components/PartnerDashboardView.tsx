'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FolderKanban, FileText, Monitor, Inbox, Library } from 'lucide-react';
import { PartnerRecord } from '@/lib/types';
import type { PartnerKpis } from '@/lib/partnerAnalyticsCompute';
import PartnerShell from './PartnerShell';
import calcStyles from './calculator.module.css';
import styles from './partnerPortal.module.css';

interface PartnerDashboardViewProps {
  viewerName: string;
  partner: PartnerRecord;
}

interface Analytics {
  kpis: PartnerKpis;
  monthly: { month: string; submitted: number; approved: number; won: number }[];
  departments: { department: string; count: number }[];
}

const ENTRY_POINTS = [
  { href: '/partner/projects', icon: FolderKanban, title: 'My Leads / Projects', desc: 'Submit a new opportunity and track every one you have sent us.' },
  { href: '/partner/quotations', icon: FileText, title: 'Quotations', desc: 'Quotations shared with you, with their versions and validity.' },
  { href: '/partner/demos', icon: Monitor, title: 'Demo Requests', desc: 'Request a product demonstration for your customer.' },
  { href: '/partner/support', icon: Inbox, title: 'Technical Support', desc: 'Raise and track after-sales support tickets.' },
  { href: '/partner/materials', icon: Library, title: 'Marketing Materials', desc: 'Brochures, datasheets, case studies and presentations.' }
];

function money(n: number): string {
  if (!n) return '₹0';
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

/** A rate that has no denominator yet prints as '—', never as 0%. */
function pct(value: number | null): string {
  return value === null ? '—' : `${value}%`;
}

export default function PartnerDashboardView({ viewerName, partner }: PartnerDashboardViewProps) {
  const firstName = viewerName.trim().split(/\s+/)[0] || viewerName;
  const [analytics, setAnalytics] = useState<Analytics | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/partner/analytics')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data) setAnalytics(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const k = analytics?.kpis;
  const maxMonthly = Math.max(1, ...(analytics?.monthly ?? []).map((m) => m.submitted));

  return (
    <PartnerShell
      title="Partner Dashboard"
      subtitle="Your opportunities, demos, quotations and support in one place"
      partnerName={partner.company_name}
      partnerCode={partner.partner_code}
    >
      <section className={styles.intro}>
        <h2 className={styles.introTitle}>Welcome back, {firstName}</h2>
        <p className={styles.introSub}>
          You are signed in to the {partner.company_name} partner account. Everything here is scoped to your
          company — submissions you send us, quotations shared with you, and tickets you have raised.
        </p>
        <span className={styles.statusChip}>Account active</span>
      </section>

      {k && (
        <>
          <h3 className={styles.sectionHeading}>Your activity</h3>
          <div className={styles.kpiRow}>
            <div className={styles.kpi}>
              <span className={styles.kpiValue}>{k.submitted}</span>
              <span className={styles.kpiLabel}>Submitted</span>
            </div>
            <div className={styles.kpi}>
              <span className={styles.kpiValue}>{k.awaitingReview}</span>
              <span className={styles.kpiLabel}>Awaiting review</span>
            </div>
            <div className={styles.kpi}>
              <span className={styles.kpiValue}>{k.active}</span>
              <span className={styles.kpiLabel}>Active</span>
            </div>
            <div className={styles.kpi}>
              <span className={styles.kpiValue}>{k.won}</span>
              <span className={styles.kpiLabel}>Won</span>
            </div>
            <div className={styles.kpi}>
              <span className={styles.kpiValue}>{pct(k.winRate)}</span>
              <span className={styles.kpiLabel}>Win rate</span>
            </div>
            <div className={styles.kpi}>
              <span className={styles.kpiValue}>{k.demosRequested}</span>
              <span className={styles.kpiLabel}>Demos requested</span>
            </div>
          </div>

          {/* Three different kinds of money, never merged into one number —
              see THE MONEY RULE in lib/partnerAnalyticsCompute.ts. The labels
              are long on purpose: "estimated" and "won" must not be mistaken
              for one another. */}
          <h3 className={styles.sectionHeading}>Value</h3>
          <div className={styles.kpiRow}>
            <div className={styles.kpi}>
              <span className={styles.kpiValue}>{money(k.estimatedValueSubmitted)}</span>
              <span className={styles.kpiLabel}>Your estimates, all submissions</span>
            </div>
            <div className={styles.kpi}>
              <span className={styles.kpiValue}>{money(k.quotedValueApproved)}</span>
              <span className={styles.kpiLabel}>Our value, accepted projects</span>
            </div>
            <div className={styles.kpi}>
              <span className={styles.kpiValue}>{money(k.wonValue)}</span>
              <span className={styles.kpiLabel}>Won business</span>
            </div>
          </div>
          <p className={calcStyles.small}>
            Estimates are the figures you submitted and are not forecasts. Only &ldquo;won business&rdquo; represents closed deals.
          </p>

          {analytics && analytics.monthly.some((m) => m.submitted > 0) && (
            <>
              <h3 className={styles.sectionHeading}>Submissions over the last 12 months</h3>
              <div className={styles.sparkRow}>
                {analytics.monthly.map((m) => (
                  <div key={m.month} className={styles.sparkCol} title={`${m.month}: ${m.submitted} submitted, ${m.won} won`}>
                    <div className={styles.sparkBar} style={{ height: `${Math.round((m.submitted / maxMonthly) * 100)}%` }} />
                    <span className={styles.sparkLabel}>{m.month.slice(5)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      <h3 className={styles.sectionHeading}>Where to go</h3>
      <div className={styles.cardGrid}>
        {ENTRY_POINTS.map((entry) => {
          const Icon = entry.icon;
          return (
            <Link key={entry.href} href={entry.href} className={styles.card}>
              <span className={styles.cardIcon}><Icon size={19} /></span>
              <p className={styles.cardTitle}>{entry.title}</p>
              <p className={styles.cardDesc}>{entry.desc}</p>
            </Link>
          );
        })}
      </div>
    </PartnerShell>
  );
}
