'use client';

import { useEffect, useMemo, useState } from 'react';
import { Users } from 'lucide-react';
import { ClientSummary, UserRole } from '@/lib/types';
import AppShell from './AppShell';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import { SkeletonRows } from './ui/Skeleton';
import EmptyState from './ui/EmptyState';
import ErrorState from './ui/ErrorState';
import FilterBar from './ui/FilterBar';
import Table, { TableColumn, TableWrap } from './ui/Table';

interface ClientMasterViewProps {
  currentUser: { username: string; role: UserRole };
}

// Read-only directory derived from Projects (+ their Quotations' line
// items) — see app/api/clients/route.ts. No create/edit UI: a client's
// details come from the projects that mention it, not from data entered
// here directly.
export default function ClientMasterView(_props: ClientMasterViewProps) {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [search, setSearch] = useState('');

  async function load() {
    setLoading(true);
    setLoadFailed(false);
    try {
      const response = await fetch('/api/clients');
      if (!response.ok) throw new Error(String(response.status));
      const data: { clients: ClientSummary[] } = await response.json();
      setClients(data.clients);
      setLoaded(true);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) => {
      const haystack = [
        c.displayName,
        ...c.contacts.flatMap((ct) => [ct.clientName, ct.phone, ct.email, ct.altContactName, ct.altContactPhone]),
        ...c.productHandlers.flatMap((h) => [h.product, h.handledBy])
      ];
      return haystack.some((v) => (v || '').toLowerCase().includes(q));
    });
  }, [clients, search]);

  const columns: TableColumn<ClientSummary>[] = [
    { key: 'client', header: 'Client', cellClassName: historyStyles.clientName, render: (c) => c.displayName },
    {
      key: 'contacts',
      header: 'Contacts',
      render: (c) =>
        c.contacts.length === 0 ? (
          <span className={calcStyles.small}>-</span>
        ) : (
          c.contacts.map((ct, i) => (
            <div key={i} className={`${calcStyles.small} ${historyStyles.contactLine}`}>
              {ct.clientName || '-'}{ct.phone ? ` · ${ct.phone}` : ''}{ct.email ? ` · ${ct.email}` : ''}
              {(ct.altContactName || ct.altContactPhone) && (
                <div className={historyStyles.altContactLine}>
                  Alt: {ct.altContactName || '-'}{ct.altContactPhone ? ` · ${ct.altContactPhone}` : ''}
                </div>
              )}
            </div>
          ))
        )
    },
    {
      key: 'productHandlers',
      header: 'Product Handlers',
      render: (c) =>
        c.productHandlers.length === 0 ? (
          <span className={calcStyles.small}>-</span>
        ) : (
          <div className={historyStyles.productHandlerList}>
            {c.productHandlers.map((h, i) => (
              <span key={i} className={`${historyStyles.priorityBadge} ${historyStyles.priorityBadgeInfo} ${historyStyles.productHandlerBadge}`}>
                {h.product} — {h.handledBy}
              </span>
            ))}
          </div>
        )
    },
    { key: 'projects', header: 'Projects', render: (c) => c.projectCount }
  ];

  return (
    <AppShell title="Client Master" subtitle="Every client across your projects — contact details and who's handling which product.">
      <FilterBar>
        <input
          type="text"
          placeholder="Search client, company, contact, product, sales person…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </FilterBar>
      {!loading && !loadFailed && (
        <div className={historyStyles.status}>
          {clients.length ? `${filtered.length} of ${clients.length} client${clients.length === 1 ? '' : 's'} shown.` : ''}
        </div>
      )}

      {loading ? (
        <TableWrap><SkeletonRows rows={8} columns={4} /></TableWrap>
      ) : loadFailed ? (
        <ErrorState message="Could not load the client directory — check your connection and try again." onRetry={load} />
      ) : (
        loaded && (
          <Table
            columns={columns}
            rows={filtered}
            rowKey={(c) => c.key}
            empty={
              <EmptyState
                icon={Users}
                title={clients.length === 0 ? 'No clients yet' : 'No clients match your search'}
                message={clients.length === 0 ? 'Clients appear here automatically once projects are created.' : 'Try a different search term.'}
              />
            }
          />
        )
      )}
    </AppShell>
  );
}
