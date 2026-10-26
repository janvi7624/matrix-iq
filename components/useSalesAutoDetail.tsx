'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import Modal, { ModalCancelButton } from './ui/Modal';
import calcStyles from './calculator.module.css';
import styles from './dailyReport.module.css';

interface SalesAutoDetailItem {
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

/**
 * The auto-cell detail popup — which records actually made up a clicked
 * "4" — shared between DailyReportForm (the matrix a cell lives in) and
 * DailyReportReadView (the summary a manager actually opens first). Was
 * DailyReportForm-only; factored out once DailyReportReadView needed the
 * exact same click-to-see-the-records behaviour on its own measure totals,
 * rather than only on the "Full grid" accordion underneath it — a manager
 * reading the summary has no reason to know the grid is where the clickable
 * numbers secretly live.
 *
 * Fetched on click, not up front: most cells on a page like this are never
 * clicked, so building every cell's record list on every load would be work
 * nobody asked for.
 */
export function useSalesAutoDetail(reportDate: string, employeeId?: string) {
  const [autoDetail, setAutoDetail] = useState<{
    measure: string;
    channel: string;
    loading: boolean;
    items: SalesAutoDetailItem[] | null;
    error: string;
  } | null>(null);

  async function openAutoDetail(measure: string, channel: string) {
    setAutoDetail({ measure, channel, loading: true, items: null, error: '' });
    try {
      const params = new URLSearchParams({ measure, channel, date: reportDate });
      if (employeeId) params.set('employeeId', employeeId);
      const response = await fetch(`/api/daily-reports/sales-auto-detail?${params.toString()}`);
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setAutoDetail({ measure, channel, loading: false, items: null, error: body?.error || 'Could not load these records.' });
        return;
      }
      const body: { items: SalesAutoDetailItem[] } = await response.json();
      setAutoDetail({ measure, channel, loading: false, items: body.items, error: '' });
    } catch {
      setAutoDetail({ measure, channel, loading: false, items: null, error: 'Could not reach the server.' });
    }
  }

  const modal = autoDetail && (
    <Modal
      title={`${autoDetail.measure} — ${autoDetail.channel}`}
      ariaLabel={`${autoDetail.measure} — ${autoDetail.channel} records`}
      onClose={() => setAutoDetail(null)}
      footer={<ModalCancelButton onClick={() => setAutoDetail(null)}>Close</ModalCancelButton>}
    >
      {autoDetail.loading && (
        <div className={calcStyles.small}>
          <Loader2 size={14} className={styles.spin} /> Loading…
        </div>
      )}
      {!autoDetail.loading && autoDetail.error && <div className={styles.errorText}>{autoDetail.error}</div>}
      {!autoDetail.loading && !autoDetail.error && autoDetail.items && autoDetail.items.length === 0 && (
        <div className={calcStyles.small}>Nothing found — the count may have changed since the page loaded. Refresh to see the latest.</div>
      )}
      {!autoDetail.loading && !autoDetail.error && autoDetail.items && autoDetail.items.length > 0 && (
        <div className={styles.autoDetailList}>
          {autoDetail.items.map((item) => (
            <Link key={item.id} href={item.href} className={styles.autoDetailRow}>
              <span>
                <div className={styles.autoDetailTitle}>{item.title}</div>
                {item.subtitle && <div className={styles.autoDetailSubtitle}>{item.subtitle}</div>}
              </span>
            </Link>
          ))}
        </div>
      )}
    </Modal>
  );

  return { openAutoDetail, modal };
}
