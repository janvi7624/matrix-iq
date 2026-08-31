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

  return (
    <AppShell title="Client Master" subtitle="Every client across your projects — contact details and who's handling which product.">
      <div className={historyStyles.toolbar}>
        <input
          type="text"
          placeholder="Search client, company, contact, product, sales person…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {!loading && !loadFailed && (
        <div className={historyStyles.status}>
          {clients.length ? `${filtered.length} of ${clients.length} client${clients.length === 1 ? '' : 's'} shown.` : ''}
        </div>
      )}

      {loading ? (
        <div className={historyStyles.tableWrap}><SkeletonRows rows={8} columns={4} /></div>
      ) : loadFailed ? (
        <ErrorState message="Could not load the client directory — check your connection and try again." onRetry={load} />
      ) : (
        loaded && (
          <div className={historyStyles.tableWrap}>
            <table className={historyStyles.table}>
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Contacts</th>
                  <th>Product Handlers</th>
                  <th>Projects</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={4}>
                      <EmptyState
                        icon={Users}
                        title={clients.length === 0 ? 'No clients yet' : 'No clients match your search'}
                        message={clients.length === 0 ? 'Clients appear here automatically once projects are created.' : 'Try a different search term.'}
                      />
                    </td>
                  </tr>
                ) : (
                  filtered.map((c) => (
                    <tr key={c.key}>
                      <td style={{ fontWeight: 600 }}>{c.displayName}</td>
                      <td>
                        {c.contacts.length === 0 ? (
                          <span className={calcStyles.small}>-</span>
                        ) : (
                          c.contacts.map((ct, i) => (
                            <div key={i} className={calcStyles.small} style={{ marginBottom: i < c.contacts.length - 1 ? 4 : 0 }}>
                              {ct.clientName || '-'}{ct.phone ? ` · ${ct.phone}` : ''}{ct.email ? ` · ${ct.email}` : ''}
                              {(ct.altContactName || ct.altContactPhone) && (
                                <div style={{ opacity: 0.75 }}>
                                  Alt: {ct.altContactName || '-'}{ct.altContactPhone ? ` · ${ct.altContactPhone}` : ''}
                                </div>
                              )}
                            </div>
                          ))
                        )}
                      </td>
                      <td>
                        {c.productHandlers.length === 0 ? (
                          <span className={calcStyles.small}>-</span>
                        ) : (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {c.productHandlers.map((h, i) => (
                              <span key={i} className={`${historyStyles.priorityBadge} ${historyStyles.priorityBadgeInfo}`} style={{ whiteSpace: 'nowrap' }}>
                                {h.product} — {h.handledBy}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td>{c.projectCount}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )
      )}
    </AppShell>
  );
}
