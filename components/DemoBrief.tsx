'use client';

import Link from 'next/link';
import { Building2, CalendarClock, ClipboardList, FileText, MapPin, MessageSquareText, MonitorPlay, Package, Target, User, Users } from 'lucide-react';
import { DemoScheduleRecord } from '@/lib/types';
import { DOMAIN_DISPLAY_NAME } from '@/lib/domainLabels';
import styles from './demoBrief.module.css';

// Everything the assigned technical person needs to decide on a demo request,
// at a glance: WHY (objective), WHAT (products & models), WHEN, WHERE, WHO,
// plus the sales team's notes. Shown above the approval form and in the
// expanded row, so nobody has to hunt for the purpose of a request.

const PRIORITY_TONE: Record<string, string> = { high: styles.pHigh, medium: styles.pMedium, low: styles.pLow };

function when(iso: string): { date: string; rel: string; soon: boolean } {
  if (!iso) return { date: 'Not scheduled', rel: '', soon: false };
  const d = new Date(iso);
  const date = d.toLocaleString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const days = Math.round((new Date(d.toDateString()).getTime() - new Date(new Date().toDateString()).getTime()) / 86400000);
  const rel = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : days === -1 ? 'Yesterday' : days > 1 ? `In ${days} days` : `${-days} days ago`;
  return { date, rel, soon: days >= 0 && days <= 2 };
}

export default function DemoBrief({ record, compact = false }: { record: DemoScheduleRecord; compact?: boolean }) {
  const w = when(record.scheduled_at);
  const virtual = record.mode === 'virtual';
  const requester = record.created_by_name || record.created_by || '—';

  return (
    <section className={`${styles.brief} ${compact ? styles.compact : ''}`} aria-label="Demo brief">
      <header className={styles.head}>
        <div>
          <span className={styles.kicker}>Demo brief</span>
          <h3 className={styles.client}>
            {record.client_name || 'Client'}
            {record.company && <span> · {record.company}</span>}
          </h3>
        </div>
        <div className={styles.tags}>
          <span className={`${styles.tag} ${PRIORITY_TONE[record.priority] || ''}`}>{record.priority} priority</span>
          <span className={`${styles.tag} ${virtual ? styles.virtual : styles.onsite}`}>
            {virtual ? <MonitorPlay size={13} /> : <MapPin size={13} />} {virtual ? 'Virtual' : 'On-site'}
          </span>
          {record.partner_name && <span className={`${styles.tag} ${styles.partner}`}>Partner · {record.partner_name}</span>}
        </div>
      </header>

      <div className={styles.why}>
        <Target size={18} />
        <div>
          <span className={styles.label}>Why this demo</span>
          <p>{record.demo_objective?.trim() || <em className={styles.missing}>No objective given — ask {requester}.</em>}</p>
        </div>
      </div>

      <div className={styles.grid}>
        <div className={styles.cell}>
          <CalendarClock size={16} />
          <div>
            <span className={styles.label}>When</span>
            <strong>{w.date}</strong>
            {w.rel && <span className={`${styles.rel} ${w.soon ? styles.soon : ''}`}>{w.rel}</span>}
          </div>
        </div>
        <div className={styles.cell}>
          {virtual ? <MonitorPlay size={16} /> : <MapPin size={16} />}
          <div>
            <span className={styles.label}>Where</span>
            <strong>{virtual ? 'Online / screen share' : record.location || 'Location not given'}</strong>
          </div>
        </div>
        <div className={styles.cell}>
          <User size={16} />
          <div>
            <span className={styles.label}>Requested by</span>
            <strong>{requester}</strong>
            {record.assigned_rep && record.assigned_rep !== record.created_by && <span className={styles.sub}>Rep: {record.assigned_rep}</span>}
          </div>
        </div>
        <div className={styles.cell}>
          <Users size={16} />
          <div>
            <span className={styles.label}>Technical team</span>
            <strong>{record.assigned_technical_person || 'Not assigned'}</strong>
            {record.technical_members?.length > 0 && <span className={styles.sub}>+ {record.technical_members.join(', ')}</span>}
          </div>
        </div>
      </div>

      <div className={styles.block}>
        <span className={styles.blockTitle}><Package size={15} /> What to demonstrate</span>
        {record.product_domains.length === 0 && record.products_required.length === 0 ? (
          <p className={styles.missing}>No products listed.</p>
        ) : (
          <>
            {record.product_domains.length > 0 && (
              <div className={styles.domains}>
                {record.product_domains.map((d) => <span key={d} className={styles.domain}>{DOMAIN_DISPLAY_NAME[d]}</span>)}
              </div>
            )}
            {record.products_required.length > 0 && (
              <ul className={styles.products}>
                {record.products_required.map((p, i) => {
                  const [head, model] = p.product.split(' — ');
                  return (
                    <li key={`${p.product}-${i}`}>
                      <span className={styles.qty}>×{p.quantity}</span>
                      <span>
                        {head}
                        {model && <b> — {model}</b>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>

      {record.notes?.trim() && (
        <div className={styles.block}>
          <span className={styles.blockTitle}><MessageSquareText size={15} /> Notes from sales</span>
          <p className={styles.notes}>{record.notes}</p>
        </div>
      )}

      {(record.project_id || record.quotation_id) && (
        <div className={styles.links}>
          {record.project_id && (
            <Link href={`/projects/${record.project_id}`} className={styles.link}><Building2 size={14} /> Open project</Link>
          )}
          {record.quotation_id && (
            <Link href={`/my-quotations?highlight=${record.quotation_id}`} className={styles.link}><FileText size={14} /> View quotation</Link>
          )}
          <span className={styles.raised}><ClipboardList size={13} /> Raised {new Date(record.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</span>
        </div>
      )}
    </section>
  );
}
