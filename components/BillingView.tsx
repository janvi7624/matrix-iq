'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, IndianRupee, Receipt } from 'lucide-react';
import { BillingRow, BillingTotals, OwnerBillingSummary, billableValue } from '@/lib/billingSummary';
import { formatMoney, formatMoneyCompact } from '@/lib/format';
import { toCsv } from '@/lib/csv';
import { exportListToPdf } from '@/lib/exportPdf';
import AppShell from './AppShell';
import Table, { TableColumn } from './ui/Table';
import StatTile from './ui/StatTile';
import FilterBar from './ui/FilterBar';
import Input from './ui/Input';
import Select from './ui/Select';
import Button from './ui/Button';
import EmptyState from './ui/EmptyState';
import ErrorState from './ui/ErrorState';
import { SkeletonRows } from './ui/Skeleton';
import { useToast } from './ui/ToastProvider';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';

// Won work, and what it is worth.
//
// Deliberately read-only: it reports what the pipeline already knows rather
// than holding a separate billing state that would drift the moment somebody
// forgot to update it. Who sees what is decided server-side by
// resolveVisibilityScope (see lib/billingStore.ts) — a salesperson's own
// deals, a manager's whole team — so this component never filters by owner
// for permission reasons, only for convenience.

interface Props {
  currentUser: { username: string; role: string };
}

interface BillingResponse {
  rows: BillingRow[];
  totals: BillingTotals;
  byOwner: OwnerBillingSummary[];
  scope: 'own' | 'team' | 'org';
  owners: string[];
}

const SCOPE_LABEL: Record<BillingResponse['scope'], string> = {
  own: 'Your own won deals.',
  team: "Your team's won deals.",
  org: 'Every won deal across the company.'
};

// What the headline figure rests on. Published because "74 lakh" means
// something different if most of it is estimates rather than purchase orders.
const BASIS_LABEL: Record<string, string> = {
  po: 'Purchase order',
  quotation: 'Approved quotation',
  estimate: 'Approx. price only',
  unknown: 'No figure recorded'
};

export default function BillingView({ currentUser }: Props) {
  const toast = useToast();
  const [data, setData] = useState<BillingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState('');

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [owner, setOwner] = useState('');
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed('');
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (owner) params.set('owner', owner);
      if (query.trim()) params.set('q', query.trim());
      const response = await fetch(`/api/billing?${params.toString()}`);
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || `Could not load billing (${response.status})`);
      setData(body as BillingResponse);
    } catch (error) {
      setLoadFailed(error instanceof Error ? error.message : 'Could not load billing.');
    } finally {
      setLoading(false);
    }
  }, [from, to, owner, query]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = data?.rows ?? [];
  const totals = data?.totals;

  // One shared row builder for the table, the CSV and the PDF, so the three
  // can never disagree about what a deal is worth.
  const exportRows = useMemo(
    () =>
      rows.map((r) => {
        const { value, basis } = billableValue(r);
        return [
          r.label,
          r.clientName,
          r.company,
          r.ownerUsername,
          r.closedOn || '-',
          r.quotationNumber || '-',
          r.quotedValue === null ? '' : r.quotedValue,
          r.poNumber || '-',
          r.poValue === null ? '' : r.poValue,
          r.approxPrice === null ? '' : r.approxPrice,
          value === null ? '' : value,
          BASIS_LABEL[basis] ?? basis
        ];
      }),
    [rows]
  );

  const EXPORT_HEADERS = [
    'Deal', 'Client', 'Company', 'Sales Person', 'Closed On',
    'Quotation', 'Quoted Value', 'PO Number', 'PO Value',
    'Approx. Price', 'Billable Value', 'Based On'
  ];

  function handleCsv() {
    if (!exportRows.length) {
      toast.error('Nothing to export for these filters.');
      return;
    }
    // toCsv escapes leading =, +, - and @ so a client name cannot become a
    // spreadsheet formula when the file is opened.
    const blob = new Blob([toCsv(EXPORT_HEADERS, exportRows)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `billing-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function handlePdf() {
    if (!exportRows.length) {
      toast.error('Nothing to export for these filters.');
      return;
    }
    exportListToPdf(
      'Billing — won deals',
      EXPORT_HEADERS,
      exportRows.map((r) => r.map((cell) => (typeof cell === 'number' ? formatMoney(cell) : String(cell)))),
      `billing-${new Date().toISOString().slice(0, 10)}.pdf`
    );
  }

  const columns: TableColumn<BillingRow>[] = [
    { key: 'deal', header: 'Deal', render: (r) => <strong>{r.label}</strong> },
    { key: 'client', header: 'Client', render: (r) => r.clientName || '-' },
    { key: 'company', header: 'Company', render: (r) => r.company || '-' },
    { key: 'owner', header: 'Sales Person', render: (r) => r.ownerUsername || '-' },
    { key: 'closed', header: 'Closed On', render: (r) => r.closedOn || '-' },
    {
      key: 'quoted',
      header: 'Quoted',
      render: (r) => (r.quotedValue === null ? <span className={calcStyles.small}>—</span> : formatMoney(r.quotedValue))
    },
    {
      key: 'po',
      header: 'PO',
      render: (r) =>
        r.poValue === null ? <span className={calcStyles.small}>—</span> : (
          <span title={r.poNumber || undefined}>{formatMoney(r.poValue)}</span>
        )
    },
    {
      key: 'billable',
      header: 'Billable',
      render: (r) => {
        const { value, basis } = billableValue(r);
        if (value === null) {
          // Said plainly rather than shown as zero: three won deals have no
          // price, no quotation and no PO, and a zero would look settled.
          return <span className={calcStyles.small} title="No PO, quotation or approx. price recorded">Not valued</span>;
        }
        return (
          <span title={`Based on: ${BASIS_LABEL[basis]}`}>
            <strong>{formatMoney(value)}</strong>
          </span>
        );
      }
    }
  ];

  return (
    <AppShell title="Billing" subtitle="Won deals and the agreed work behind them — what is billable, and what it rests on.">
      {totals && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 18 }}>
          <StatTile label="Won deals" value={totals.count} icon={<Receipt size={16} />} />
          {/* Compact in the tile, exact on hover — the convention
              ProjectsView established for the same reason: a seven-figure
              rupee value does not fit a tile and wraps mid-number. */}
          <StatTile
            label="Billable value"
            value={<span title={formatMoney(totals.value)}>{formatMoneyCompact(totals.value)}</span>}
            tone="brand"
            icon={<IndianRupee size={16} />}
          />
          {/* The count belongs in the label. Crammed into the value it
              read as "4 · ₹10,77,980" and wrapped onto two lines. */}
          <StatTile
            label={`With a PO (${totals.withPurchaseOrder})`}
            value={<span title={formatMoney(totals.purchaseOrderValue)}>{formatMoneyCompact(totals.purchaseOrderValue)}</span>}
            tone="success"
          />
          <StatTile
            label={`On quotation (${totals.byBasis.quotation.count})`}
            value={<span title={formatMoney(totals.byBasis.quotation.value)}>{formatMoneyCompact(totals.byBasis.quotation.value)}</span>}
            tone="info"
          />
          <StatTile
            label={`Estimate only (${totals.byBasis.estimate.count})`}
            value={<span title={formatMoney(totals.byBasis.estimate.value)}>{formatMoneyCompact(totals.byBasis.estimate.value)}</span>}
            tone="warning"
          />
          {/* Surfaced rather than buried: a won deal nobody has priced is a
              gap in the forecast, not a zero. */}
          <StatTile label="Not valued" value={totals.unvalued} tone={totals.unvalued > 0 ? 'danger' : undefined} />
        </div>
      )}

      {data && <div className={historyStyles.status}>{SCOPE_LABEL[data.scope]}</div>}

      <FilterBar>
        <Input auto type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Closed from" />
        <Input auto type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Closed to" />
        {data && data.owners.length > 1 && (
          <Select auto value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Sales person">
            <option value="">All sales people</option>
            {data.owners.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </Select>
        )}
        <Input auto placeholder="Search deal, client, PO…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <Button variant="ghost" compact icon={<Download size={15} />} onClick={handleCsv}>CSV</Button>
        <Button variant="ghost" compact icon={<Download size={15} />} onClick={handlePdf}>PDF</Button>
      </FilterBar>

      {data && data.byOwner.length > 1 && (
        <details className={historyStyles.detailsBlock}>
          <summary className={historyStyles.detailsSummary}>
            By sales person
            <span className={historyStyles.detailsCount}>({data.byOwner.length})</span>
          </summary>
          <div className={historyStyles.detailsBody}>
            <div className={historyStyles.tableWrap}>
              <table className={historyStyles.table}>
                <thead>
                  <tr><th>Sales Person</th><th>Deals</th><th>Billable</th><th>With a PO</th><th>Not valued</th></tr>
                </thead>
                <tbody>
                  {data.byOwner.map((o) => (
                    <tr key={o.ownerUsername || '(none)'}>
                      <td>{o.ownerUsername || '(unassigned)'}</td>
                      <td>{o.count}</td>
                      <td>{formatMoney(o.value)}</td>
                      <td>{o.withPurchaseOrder}</td>
                      <td>{o.unvalued}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </details>
      )}

      {loadFailed ? (
        <ErrorState message={loadFailed} onRetry={load} />
      ) : loading ? (
        <div className={historyStyles.tableWrap}><SkeletonRows rows={6} columns={8} /></div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No won deals yet"
          message={
            from || to || owner || query
              ? 'Nothing matches these filters — try clearing one.'
              : 'A project closed as Won, or a quotation marked Approved, shows up here.'
          }
        />
      ) : (
        <Table columns={columns} rows={rows} rowKey={(r) => r.id} />
      )}
    </AppShell>
  );
}
