'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { SUPPORT_STATUS_LABEL, SupportTicketStatus } from '@/lib/supportTicketWorkflow';
import AppShell from './AppShell';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import styles from './partnerPortal.module.css';

interface SlaAssessment {
  responseState: string;
  resolutionState: string;
  minutesRemaining: number | null;
  breached: boolean;
}

interface Ticket {
  id: string;
  ticket_number: string;
  title: string;
  priority: string;
  status: SupportTicketStatus;
  partner_name: string;
  assignee_name: string;
  customer_name: string;
  product: string;
  created_at: string;
  reopened_count: number;
  sla: SlaAssessment | null;
}

const QUEUES = [
  { key: 'open', label: 'All open' },
  { key: 'unassigned', label: 'Unassigned' },
  { key: 'mine', label: 'Assigned to me' },
  { key: 'awaiting_partner', label: 'Awaiting partner' },
  { key: 'escalated', label: 'Escalated' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'closed', label: 'Closed' }
];

// Red for a missed target, amber for one about to be missed. Anything else
// is deliberately unstyled — colouring every row makes none of them stand out.
function slaTone(sla: SlaAssessment | null): string {
  if (!sla) return '';
  if (sla.breached) return 'var(--mx-danger)';
  if (sla.resolutionState === 'due_soon' || sla.responseState === 'due_soon') return 'var(--mx-warning)';
  return '';
}

function slaText(sla: SlaAssessment | null): string {
  if (!sla) return '—';
  if (sla.breached) return 'Breached';
  if (sla.minutesRemaining === null) return 'Met';
  if (sla.minutesRemaining < 0) return 'Breached';
  const h = Math.floor(sla.minutesRemaining / 60);
  const m = sla.minutesRemaining % 60;
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
}

export default function SupportTicketsView() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [queue, setQueue] = useState('open');
  const [status, setStatus] = useState('Loading...');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/support/tickets?queue=${encodeURIComponent(queue)}`);
      if (!response.ok) {
        setStatus(response.status === 403 ? 'You do not have access to the support queue.' : 'Could not load tickets.');
        setTickets([]);
        return;
      }
      const data: { tickets: Ticket[] } = await response.json();
      setTickets(data.tickets);
      setStatus(data.tickets.length ? '' : 'Nothing in this queue.');
    } catch {
      setStatus('Could not reach the server.');
    }
  }, [queue]);

  useEffect(() => {
    load();
  }, [load]);

  const visible = tickets.filter((t) => {
    const needle = search.trim().toLowerCase();
    if (!needle) return true;
    return (
      t.ticket_number.toLowerCase().includes(needle) ||
      t.title.toLowerCase().includes(needle) ||
      t.partner_name.toLowerCase().includes(needle) ||
      t.customer_name.toLowerCase().includes(needle) ||
      t.product.toLowerCase().includes(needle)
    );
  });

  const breached = tickets.filter((t) => t.sla?.breached).length;

  return (
    <AppShell title="Technical Support" subtitle="Operations › after-sales support tickets">
      <div className={styles.kpiRow}>
        <div className={styles.kpi}>
          <span className={styles.kpiValue}>{tickets.length}</span>
          <span className={styles.kpiLabel}>In this queue</span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiValue} style={breached ? { color: 'var(--mx-danger)' } : undefined}>{breached}</span>
          <span className={styles.kpiLabel}>SLA breached</span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiValue}>{tickets.filter((t) => !t.assignee_name).length}</span>
          <span className={styles.kpiLabel}>Unassigned</span>
        </div>
      </div>

      <div className={historyStyles.toolbar}>
        <select value={queue} onChange={(e) => setQueue(e.target.value)}>
          {QUEUES.map((q) => (
            <option key={q.key} value={q.key}>{q.label}</option>
          ))}
        </select>
        <input type="text" placeholder="Search ticket, partner, customer or product..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {status && <div className={historyStyles.status}>{status}</div>}

      {visible.length > 0 && (
        <div className={historyStyles.tableWrap}>
          <table className={historyStyles.table}>
            <thead>
              <tr>
                <th>Ticket</th>
                <th>Raised by</th>
                <th>Product</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Assignee</th>
                <th>SLA</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((t) => (
                <tr key={t.id}>
                  <td>
                    <Link href={`/support/${t.id}`}>{t.ticket_number}</Link>
                    <div className={calcStyles.small}>{t.title}</div>
                    {t.reopened_count > 0 && <div className={calcStyles.small}>Reopened {t.reopened_count}×</div>}
                  </td>
                  <td>{t.partner_name || <span className={calcStyles.small}>Internal</span>}</td>
                  <td>{t.product || '-'}</td>
                  <td>{t.priority}</td>
                  <td><span className={historyStyles.statusPill}>{SUPPORT_STATUS_LABEL[t.status] ?? t.status}</span></td>
                  <td>{t.assignee_name || <span className={calcStyles.small}>Unassigned</span>}</td>
                  <td style={{ color: slaTone(t.sla) || undefined, fontWeight: t.sla?.breached ? 600 : undefined }}>
                    {slaText(t.sla)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
