'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Clock, Plus } from 'lucide-react';
import { PartnerRecord } from '@/lib/types';
import { PARTNER_DOCUMENT_KINDS } from '@/lib/partnerOnboarding';
import AppShell from './AppShell';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import styles from './partnerWorkspace.module.css';

// "My partners" — the Partner module's home.
//
// One screen per person's own book of partners, outside /admin. What it
// leads with is deliberate: the partners waiting on THIS person to approve a
// document come first, because that is the only thing here that blocks
// somebody else from working.

interface OnboardingSummary {
  allApproved: boolean;
  approvedCount: number;
  awaitingReview: number;
  rejected: number;
  missing: number;
}

interface WorkspacePartner extends PartnerRecord {
  onboarding: OnboardingSummary;
}

function onboardingLabel(o: OnboardingSummary): { text: string; tone: 'ok' | 'wait' | 'todo' } {
  if (o.allApproved) return { text: 'Fully onboarded', tone: 'ok' };
  if (o.awaitingReview > 0) {
    return {
      text: `${o.awaitingReview} document${o.awaitingReview === 1 ? '' : 's'} awaiting your review`,
      tone: 'wait'
    };
  }
  if (o.rejected > 0) return { text: `${o.rejected} sent back — waiting on the partner`, tone: 'todo' };
  return { text: `${o.approvedCount} of ${PARTNER_DOCUMENT_KINDS.length} approved`, tone: 'todo' };
}

export default function PartnerWorkspaceView() {
  const [partners, setPartners] = useState<WorkspacePartner[]>([]);
  const [canCreate, setCanCreate] = useState(false);
  const [seesAll, setSeesAll] = useState(false);
  const [status, setStatus] = useState('Loading…');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/partners');
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setStatus(body?.error || 'Could not load your partners.');
        return;
      }
      const body = await res.json();
      setPartners(body.partners || []);
      setCanCreate(!!body.canCreate);
      setSeesAll(!!body.seesAll);
      setStatus('');
    } catch {
      setStatus('Could not reach the server.');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // The partners this person is actually holding up.
  const needsMe = partners.filter((p) => p.onboarding.awaitingReview > 0);

  return (
    <AppShell
      title="Partner"
      subtitle={seesAll ? 'Every partner account, and what each one is waiting on.' : 'Your partners, and what each one is waiting on.'}
    >
      {status ? (
        <div className={calcStyles.sectionPanel}><p className={calcStyles.small}>{status}</p></div>
      ) : (
        <>
          <div className={styles.headerRow}>
            <div className={styles.counts}>
              <span><strong>{partners.length}</strong> partner{partners.length === 1 ? '' : 's'}</span>
              {needsMe.length > 0 && (
                <span className={styles.needsMe}>
                  <AlertTriangle size={14} /> {needsMe.length} waiting on you
                </span>
              )}
            </div>
            {canCreate && (
              <Link href="/partners/new" className={`${historyStyles.button} ${historyStyles.primary}`}>
                <Plus size={15} /> New partner
              </Link>
            )}
          </div>

          {partners.length === 0 ? (
            <div className={calcStyles.sectionPanel}>
              <p className={calcStyles.small}>
                {canCreate
                  ? 'No partners yet. Create one, then issue their portal login — they upload their Agreement, NDA and Payment Agreement, and you approve them here.'
                  : 'No partners are assigned to you yet. You will see a partner here once you are named as its relationship manager.'}
              </p>
            </div>
          ) : (
            <div className={historyStyles.tableWrap}>
              <table className={historyStyles.table}>
                <thead>
                  <tr>
                    <th>Partner</th>
                    <th>Code</th>
                    <th>Status</th>
                    <th>Onboarding</th>
                    <th>Relationship manager</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {/* Waiting-on-you first, then the rest — the list doubles as
                      the to-do, so the order has to mean something. */}
                  {[...partners]
                    .sort((a, b) => b.onboarding.awaitingReview - a.onboarding.awaitingReview)
                    .map((partner) => {
                      const label = onboardingLabel(partner.onboarding);
                      return (
                        <tr key={partner.id}>
                          <td>{partner.company_name}</td>
                          <td className={historyStyles.num}>{partner.partner_code}</td>
                          <td>{partner.status}</td>
                          <td>
                            <span className={`${styles.onboardingPill} ${styles[label.tone]}`}>
                              {label.tone === 'ok' ? <CheckCircle2 size={13} /> : <Clock size={13} />} {label.text}
                            </span>
                          </td>
                          <td>{partner.relationship_manager_name || partner.created_by_name || '—'}</td>
                          <td>
                            <Link className={historyStyles.button} href={`/partners/${partner.id}`}>Open</Link>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}
