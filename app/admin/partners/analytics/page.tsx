'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { PartnerKpis } from '@/lib/partnerAnalyticsCompute';
import AppShell from '@/components/AppShell';
import historyStyles from '@/components/quotationHistory.module.css';
import calcStyles from '@/components/calculator.module.css';
import pageStyles from '../partnersPage.module.css';

interface ComparisonRow {
  partnerId: string;
  partnerCode: string;
  companyName: string;
  status: string;
  relationshipManager: string;
  kpis: PartnerKpis;
}

interface MaterialUsage {
  materialId: string;
  title: string;
  product: string;
  views: number;
  lastAccessedAt: string;
}

type SortKey = 'company' | 'submitted' | 'won' | 'wonValue' | 'winRate';

function money(n: number): string {
  return `₹${(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

// A rate with no denominator prints as '—'. "0%" would say we judged them
// and they failed; "—" says nothing has closed yet. Those are different.
function pct(value: number | null): string {
  return value === null ? '—' : `${value}%`;
}

export default function PartnerAnalyticsPage() {
  const [rows, setRows] = useState<ComparisonRow[]>([]);
  const [materials, setMaterials] = useState<MaterialUsage[]>([]);
  const [status, setStatus] = useState('Loading...');
  const [sort, setSort] = useState<SortKey>('wonValue');

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/partners/analytics');
      if (!response.ok) {
        setStatus(response.status === 403 ? 'You do not have access to partner analytics.' : 'Could not load partner analytics.');
        return;
      }
      const data: { partners: ComparisonRow[]; materials: MaterialUsage[] } = await response.json();
      setRows(data.partners);
      setMaterials(data.materials);
      setStatus(data.partners.length ? '' : 'No partners yet.');
    } catch {
      setStatus('Could not reach the server.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      switch (sort) {
        case 'company':
          return a.companyName.localeCompare(b.companyName);
        case 'submitted':
          return b.kpis.submitted - a.kpis.submitted;
        case 'won':
          return b.kpis.won - a.kpis.won;
        case 'winRate':
          // Partners with no closed deals sort last rather than as 0% —
          // they have not underperformed, they have not finished anything.
          return (b.kpis.winRate ?? -1) - (a.kpis.winRate ?? -1);
        default:
          return b.kpis.wonValue - a.kpis.wonValue;
      }
    });
    return copy;
  }, [rows, sort]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          submitted: acc.submitted + r.kpis.submitted,
          awaitingReview: acc.awaitingReview + r.kpis.awaitingReview,
          won: acc.won + r.kpis.won,
          wonValue: acc.wonValue + r.kpis.wonValue
        }),
        { submitted: 0, awaitingReview: 0, won: 0, wonValue: 0 }
      ),
    [rows]
  );

  return (
    <AppShell title="Partner Analytics" subtitle="Sales › partner performance, side by side">
      <div className={pageStyles.actionsRow}>
        <Link className={historyStyles.button} href="/admin/partners">← All partners</Link>
      </div>

      {status && <div className={historyStyles.status}>{status}</div>}

      {rows.length > 0 && (
        <>
          <div className={pageStyles.detailGrid}>
            <div className={pageStyles.detailItem}>
              <span className={pageStyles.detailLabel}>Partners</span>
              <span className={pageStyles.detailValue}>{rows.length}</span>
            </div>
            <div className={pageStyles.detailItem}>
              <span className={pageStyles.detailLabel}>Submissions</span>
              <span className={pageStyles.detailValue}>{totals.submitted}</span>
            </div>
            <div className={pageStyles.detailItem}>
              <span className={pageStyles.detailLabel}>Awaiting review</span>
              <span className={pageStyles.detailValue}>{totals.awaitingReview}</span>
            </div>
            <div className={pageStyles.detailItem}>
              <span className={pageStyles.detailLabel}>Won business</span>
              <span className={pageStyles.detailValue}>{money(totals.wonValue)}</span>
            </div>
          </div>

          <div className={historyStyles.toolbar}>
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              <option value="wonValue">Sort by won business</option>
              <option value="won">Sort by deals won</option>
              <option value="winRate">Sort by win rate</option>
              <option value="submitted">Sort by submissions</option>
              <option value="company">Sort by company</option>
            </select>
          </div>

          <div className={historyStyles.tableWrap}>
            <table className={historyStyles.table}>
              <thead>
                <tr>
                  <th>Partner</th>
                  <th>Manager</th>
                  <th>Submitted</th>
                  <th>Awaiting</th>
                  <th>Active</th>
                  <th>Won</th>
                  <th>Win rate</th>
                  <th>Demos</th>
                  <th>Their estimates</th>
                  <th>Won business</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.partnerId}>
                    <td>
                      <Link href={`/admin/partners/${r.partnerId}`}>{r.companyName}</Link>
                      <div className={calcStyles.small}>{r.partnerCode} · {r.status}</div>
                    </td>
                    <td>{r.relationshipManager || <span className={pageStyles.muted}>—</span>}</td>
                    <td>{r.kpis.submitted}</td>
                    <td>{r.kpis.awaitingReview || <span className={pageStyles.muted}>—</span>}</td>
                    <td>{r.kpis.active}</td>
                    <td>{r.kpis.won}</td>
                    <td>{pct(r.kpis.winRate)}</td>
                    <td>{r.kpis.demosRequested}</td>
                    {/* Labelled "their estimates", never "pipeline" — these
                        are unvetted partner figures. */}
                    <td>{money(r.kpis.estimatedValueSubmitted)}</td>
                    <td><strong>{money(r.kpis.wonValue)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={calcStyles.small}>
            &ldquo;Their estimates&rdquo; are figures partners submitted and are not forecasts or revenue. Only &ldquo;won
            business&rdquo; represents closed deals, valued at our own figure.
          </p>
        </>
      )}

      {materials.length > 0 && (
        <>
          <h2 className={calcStyles.h2}>Published material usage</h2>
          <div className={historyStyles.tableWrap}>
            <table className={historyStyles.table}>
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Product</th>
                  <th>Opens</th>
                  <th>Last opened</th>
                </tr>
              </thead>
              <tbody>
                {materials.slice(0, 25).map((m) => (
                  <tr key={m.materialId}>
                    <td>{m.title}</td>
                    <td>{m.product}</td>
                    <td>{m.views}</td>
                    <td>{m.lastAccessedAt ? new Date(m.lastAccessedAt).toLocaleDateString() : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </AppShell>
  );
}
