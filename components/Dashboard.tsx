'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { QuotationRecord, UserRole } from '@/lib/types';
import { needsFollowUp } from '@/lib/followUp';
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
  { title: 'Quotation', desc: 'Create a new quotation — AV, Robotics, AI Video Analytics, System Integration & VisitIQ VMS.', href: '/quotation' },
  { title: 'Site Visit Report', desc: 'Log a site visit — client, address, attendees, and findings.', href: '/site-visits' },
  { title: 'CRM', desc: 'Track leads, prospects, and customers.', href: '/crm' },
  { title: 'Demo Schedule', desc: 'Book and track product demos.', href: '/demo-schedule' },
  { title: 'Update Details of Visit', desc: 'Close out or update an existing site visit report.', href: '/site-visits?focus=open' },
  { title: 'Travel Schedule', desc: 'Log rep travel for client visits.', href: '/travel-schedule' }
];

export default function Dashboard({ currentUser }: DashboardProps) {
  const [followUpCount, setFollowUpCount] = useState<number | null>(null);

  const isPrivileged = currentUser.role === 'admin' || currentUser.role === 'superadmin';

  useEffect(() => {
    if (!isPrivileged) return;
    fetch('/api/admin/quotations')
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: QuotationRecord[]) => setFollowUpCount(rows.filter((r) => needsFollowUp(r)).length))
      .catch(() => setFollowUpCount(null));
  }, [isPrivileged]);

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
