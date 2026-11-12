'use client';

import { useEffect, useState } from 'react';
import AppShell from './AppShell';
import { SkeletonRows } from './ui/Skeleton';
import historyStyles from './quotationHistory.module.css';
import { ProductManagerRollup } from '@/lib/types';

function money(n: number): string {
  return n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

export default function AdminProductManagersView() {
  const [rows, setRows] = useState<ProductManagerRollup[] | null>(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    fetch('/api/admin/product-managers')
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then(setRows)
      .catch(() => setLoadError('Could not load Product Managers.'));
  }, []);

  const content = !rows ? (
    loadError ? <div className={historyStyles.loginError}>{loadError}</div> : <SkeletonRows rows={4} />
  ) : (
    <div className={historyStyles.tableWrap}>
      <table className={historyStyles.table}>
        <thead>
          <tr><th>Product Manager</th><th>Products</th><th>Pending</th><th>Won</th><th>Lost</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.pm_id}>
              <td>{r.pm_name}</td>
              <td className={historyStyles.num}>{r.product_count}</td>
              <td className={historyStyles.amount}>₹{money(r.pending_value)}</td>
              <td className={historyStyles.amount}>₹{money(r.won_value)}</td>
              <td className={historyStyles.amount}>₹{money(r.lost_value)}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={5}>No one has created a product yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );

  return (
    <AppShell title="Product Managers" subtitle="Administration › every Product Manager's Pending/Won/Lost rollup">
      {content}
    </AppShell>
  );
}
