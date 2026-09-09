'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Users, ChevronDown, ChevronUp } from 'lucide-react';
import { ClientProject, ClientSummary, ProjectPriority, ProjectStatus, UserRole } from '@/lib/types';
import { STAGE_LABEL } from '@/lib/projectStages';
import AppShell from './AppShell';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import styles from './clientMaster.module.css';
import { SkeletonRows } from './ui/Skeleton';
import EmptyState from './ui/EmptyState';
import ErrorState from './ui/ErrorState';
import FilterBar from './ui/FilterBar';
import Select from './ui/Select';
import Input from './ui/Input';
import PhoneInput from './ui/PhoneInput';
import { Field, FieldRow } from './ui/Field';
import SubmitButton from './ui/SubmitButton';
import { useToast } from './ui/ToastProvider';
import Table, { TableColumn } from './ui/Table';
import StatTile from './ui/StatTile';
import StatusBadge, { StatusTone } from './ui/StatusBadge';
import PriorityBadge, { PriorityTone } from './ui/PriorityBadge';
import Popover from './ui/Popover';
import Drawer from './ui/Drawer';
import Pagination from './ui/Pagination';

interface ClientMasterViewProps {
  currentUser: { username: string; role: UserRole };
}

const EMPTY_ADD_FORM = { clientName: '', company: '', phone: '', email: '', address: '' };

const PAGE_SIZE = 20;

const STATUS_LABEL: Record<ProjectStatus, string> = { active: 'Active', on_hold: 'On Hold', won: 'Won', lost: 'Lost' };
const STATUS_TONE: Record<ProjectStatus, StatusTone> = { active: 'confirmed', on_hold: 'pending', won: 'won', lost: 'lost' };
const PRIORITY_LABEL: Record<ProjectPriority, string> = { low: 'Low', medium: 'Medium', high: 'High' };
const PRIORITY_TONE: Record<ProjectPriority, PriorityTone> = { low: 'cool', medium: 'info', high: 'warm' };

type ActiveFilter = '' | 'has' | 'none';
type HandlerFilter = '' | 'has' | 'none';
type SortKey = 'name' | 'company' | 'owner' | 'projects' | 'updated' | 'created';

const SORT_LABEL: Record<SortKey, string> = {
  name: 'Name', company: 'Company Name', owner: 'Client Owner', projects: 'Project Count', updated: 'Last Updated', created: 'Created Date'
};

const COLUMN_KEYS = ['srNo', 'name', 'company', 'mobile', 'email', 'handlers', 'projects', 'owner', 'remarks', 'defaultUser'] as const;
type ColumnKey = (typeof COLUMN_KEYS)[number];
const COLUMN_LABEL: Record<ColumnKey, string> = {
  srNo: 'Sr. No.', name: 'Name', company: 'Company Name', mobile: 'Mobile Number', email: 'E-mail ID',
  handlers: 'Product Handlers', projects: 'Projects', owner: 'Whose Client', remarks: 'Remarks', defaultUser: 'By Default User ID'
};
const COLUMN_STORAGE_KEY = 'clientMaster.visibleColumns.v1';

function formatDate(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleDateString('en-IN');
  } catch {
    return iso;
  }
}

function isThisMonth(iso: string): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

function hasActiveProject(c: ClientSummary): boolean {
  return (c.statusCounts.active || 0) > 0;
}

// Safe tel:/mailto: link — never links malformed values, just shows the raw
// text so nothing silently disappears from the table.
function isLikelyPhone(v: string): boolean {
  return /^[+()\-\d\s]{6,}$/.test(v);
}
function isLikelyEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export default function ClientMasterView({ currentUser }: ClientMasterViewProps) {
  const toast = useToast();
  // Engineer accounts can't originate Sales projects (see app/api/projects
  // POST's own guard) — Client Master's "manual entry" creates one under the
  // hood, so it's hidden for the same accounts that can't use "+ New
  // Project" on the Project Dashboard either.
  const canAddManually = currentUser.role !== 'engineer';
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY_ADD_FORM);
  const [adding, setAdding] = useState(false);

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [companyFilter, setCompanyFilter] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [handlerNameFilter, setHandlerNameFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('');
  const [productHandlerFilter, setProductHandlerFilter] = useState<HandlerFilter>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [sortKey, setSortKey] = useState<SortKey>('updated');
  const [sortDesc, setSortDesc] = useState(true);
  const [page, setPage] = useState(1);
  const [showOwnership, setShowOwnership] = useState(false);
  const [drawerKey, setDrawerKey] = useState<string | null>(null);
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnKey>>(new Set(COLUMN_KEYS));

  // Debounced search (spec section 11) — plain setTimeout, no new dependency.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim().toLowerCase()), 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLUMN_STORAGE_KEY);
      if (raw) {
        const saved: string[] = JSON.parse(raw);
        setVisibleColumns(new Set(saved.filter((k): k is ColumnKey => (COLUMN_KEYS as readonly string[]).includes(k))));
      }
    } catch {
      // ignore — falls back to the all-visible default
    }
  }, []);

  function toggleColumn(key: ColumnKey) {
    setVisibleColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        // ignore — localStorage may be unavailable (private mode etc.)
      }
      return next;
    });
  }

  async function load() {
    setLoading(true);
    setLoadFailed(false);
    try {
      const response = await fetch('/api/clients');
      if (!response.ok) throw new Error(String(response.status));
      const data: { clients: ClientSummary[] } = await response.json();
      setClients(data.clients);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }

  // Client Master is a read-only directory derived entirely from Project
  // records (see lib/clientMasterStore.ts) — there's no separate clients
  // table to insert into. "Manual entry" is a lightweight shortcut that
  // creates a minimal Project under the hood (reusing the exact same
  // POST /api/projects endpoint, validation, and visibility as the Project
  // Dashboard's own "+ New Project"), which then appears here automatically
  // through the normal aggregation — never a second, parallel client store.
  async function handleAddClient(e: FormEvent) {
    e.preventDefault();
    if (!addForm.clientName.trim() && !addForm.company.trim()) {
      toast.error('Client name or company is required.');
      return;
    }
    setAdding(true);
    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(addForm)
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || String(response.status));
      }
      setAddForm(EMPTY_ADD_FORM);
      setShowAddForm(false);
      await load();
      toast.success('Client added.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not add this client.');
    } finally {
      setAdding(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Reset to page 1 whenever the effective result set changes underneath the
  // current page.
  useEffect(() => {
    setPage(1);
  }, [search, companyFilter, ownerFilter, handlerNameFilter, activeFilter, productHandlerFilter, dateFrom, dateTo]);

  const distinctCompanies = useMemo(() => Array.from(new Set(clients.map((c) => c.displayName))).sort(), [clients]);
  const distinctOwners = useMemo(() => {
    const map = new Map<string, string>();
    clients.forEach((c) => c.owners.forEach((o) => map.set(o.username, o.name)));
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [clients]);
  const distinctHandlers = useMemo(() => {
    const set = new Set<string>();
    clients.forEach((c) => c.productHandlers.forEach((h) => set.add(h.product)));
    return Array.from(set).sort();
  }, [clients]);

  const ownerCounts = useMemo(() => {
    const map = new Map<string, { name: string; count: number }>();
    clients.forEach((c) =>
      c.owners.forEach((o) => {
        const entry = map.get(o.username) || { name: o.name, count: 0 };
        entry.count += 1;
        map.set(o.username, entry);
      })
    );
    return Array.from(map.entries())
      .map(([username, v]) => ({ username, ...v }))
      .sort((a, b) => b.count - a.count);
  }, [clients]);

  const kpis = useMemo(
    () => ({
      total: clients.length,
      withActive: clients.filter(hasActiveProject).length,
      withoutActive: clients.filter((c) => !hasActiveProject(c)).length,
      addedThisMonth: clients.filter((c) => isThisMonth(c.createdAt)).length
    }),
    [clients]
  );

  const filtered = useMemo(() => {
    return clients.filter((c) => {
      if (companyFilter && c.displayName !== companyFilter) return false;
      if (ownerFilter && !c.owners.some((o) => o.username === ownerFilter)) return false;
      if (handlerNameFilter && !c.productHandlers.some((h) => h.product === handlerNameFilter)) return false;
      if (activeFilter === 'has' && !hasActiveProject(c)) return false;
      if (activeFilter === 'none' && hasActiveProject(c)) return false;
      if (productHandlerFilter === 'has' && c.productHandlers.length === 0) return false;
      if (productHandlerFilter === 'none' && c.productHandlers.length > 0) return false;
      if (dateFrom && (!c.createdAt || c.createdAt.slice(0, 10) < dateFrom)) return false;
      if (dateTo && (!c.createdAt || c.createdAt.slice(0, 10) > dateTo)) return false;
      if (search) {
        const haystack = [
          c.displayName,
          ...c.contacts.flatMap((ct) => [ct.clientName, ct.phone, ct.email, ct.altContactName, ct.altContactPhone]),
          ...c.productHandlers.flatMap((h) => [h.product, h.handledBy]),
          ...c.owners.flatMap((o) => [o.name, o.username]),
          ...c.projects.map((p) => STATUS_LABEL[p.status])
        ];
        if (!haystack.some((v) => (v || '').toLowerCase().includes(search))) return false;
      }
      return true;
    });
  }, [clients, companyFilter, ownerFilter, handlerNameFilter, activeFilter, productHandlerFilter, dateFrom, dateTo, search]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    const dir = sortDesc ? -1 : 1;
    list.sort((a, b) => {
      switch (sortKey) {
        case 'name':
          return dir * (a.contacts[0]?.clientName || '').localeCompare(b.contacts[0]?.clientName || '');
        case 'company':
          return dir * a.displayName.localeCompare(b.displayName);
        case 'owner':
          return dir * (a.owners[0]?.name || '').localeCompare(b.owners[0]?.name || '');
        case 'projects':
          return dir * (a.projectCount - b.projectCount);
        case 'created':
          return dir * (a.createdAt || '').localeCompare(b.createdAt || '');
        case 'updated':
        default:
          return dir * (a.updatedAt || '').localeCompare(b.updatedAt || '');
      }
    });
    return list;
  }, [filtered, sortKey, sortDesc]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageRows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const drawerClient = drawerKey ? clients.find((c) => c.key === drawerKey) : null;

  function clearAllFilters() {
    setCompanyFilter('');
    setOwnerFilter('');
    setHandlerNameFilter('');
    setActiveFilter('');
    setProductHandlerFilter('');
    setDateFrom('');
    setDateTo('');
    setSearchInput('');
  }

  function ownerCell(c: ClientSummary): string {
    if (!c.owners.length) return 'Unassigned';
    return c.owners.length === 1 ? c.owners[0].name : `${c.owners[0].name} +${c.owners.length - 1}`;
  }

  function defaultUserCell(c: ClientSummary): string {
    if (!c.owners.length) return '-';
    return c.owners.length === 1 ? c.owners[0].username : `${c.owners[0].username} +${c.owners.length - 1}`;
  }

  const allColumns: TableColumn<ClientSummary>[] = [
    { key: 'srNo', header: 'Sr. No.', render: (c) => sorted.indexOf(c) + 1 },
    {
      key: 'name',
      header: 'Name',
      render: (c) => {
        const primary = c.contacts[0];
        return (
          <div>
            <div className={styles.primaryName}>{primary?.clientName || '-'}</div>
            {c.contacts.length > 1 && (
              <Popover ariaLabel="Additional contacts" trigger={`+${c.contacts.length - 1} contacts`}>
                <div className={calcStyles.small} style={{ fontWeight: 700, marginBottom: 8 }}>Contacts</div>
                {c.contacts.map((ct, i) => (
                  <div key={i} style={{ padding: '6px 0', borderBottom: i < c.contacts.length - 1 ? '1px solid var(--mx-border)' : 'none' }}>
                    <div style={{ fontWeight: 600 }}>{ct.clientName || '-'}</div>
                    <div className={calcStyles.small}>{ct.phone}{ct.phone && ct.email ? ' · ' : ''}{ct.email}</div>
                    {(ct.altContactName || ct.altContactPhone) && (
                      <div className={calcStyles.small}>Alt: {ct.altContactName || '-'}{ct.altContactPhone ? ` · ${ct.altContactPhone}` : ''}</div>
                    )}
                  </div>
                ))}
              </Popover>
            )}
          </div>
        );
      }
    },
    { key: 'company', header: 'Company Name', cellClassName: historyStyles.clientName, render: (c) => c.displayName },
    {
      key: 'mobile',
      header: 'Mobile Number',
      render: (c) => {
        const phone = c.contacts[0]?.phone || '';
        if (!phone) return '-';
        return isLikelyPhone(phone) ? <a href={`tel:${phone}`} onClick={(e) => e.stopPropagation()}>{phone}</a> : phone;
      }
    },
    {
      key: 'email',
      header: 'E-mail ID',
      render: (c) => {
        const email = c.contacts[0]?.email || '';
        if (!email) return '-';
        return isLikelyEmail(email) ? <a href={`mailto:${email}`} onClick={(e) => e.stopPropagation()}>{email}</a> : email;
      }
    },
    {
      key: 'handlers',
      header: 'Product Handlers',
      render: (c) =>
        c.productHandlers.length === 0 ? (
          <span className={calcStyles.small}>-</span>
        ) : (
          <Popover ariaLabel="Product handlers" trigger={`${c.productHandlers.length} Handler${c.productHandlers.length === 1 ? '' : 's'}`}>
            <div className={calcStyles.small} style={{ fontWeight: 700, marginBottom: 8 }}>Product Handlers</div>
            {c.productHandlers.map((h, i) => (
              <div key={i} style={{ padding: '6px 0', borderBottom: i < c.productHandlers.length - 1 ? '1px solid var(--mx-border)' : 'none' }}>
                <div style={{ fontWeight: 600 }}>{h.product}</div>
                <div className={calcStyles.small}>{h.handledBy}</div>
              </div>
            ))}
          </Popover>
        )
    },
    {
      key: 'projects',
      header: 'Projects',
      render: (c) => (
        <Popover ariaLabel="Projects" trigger={`${c.projectCount} Project${c.projectCount === 1 ? '' : 's'}`}>
          <div className={calcStyles.small} style={{ fontWeight: 700, marginBottom: 8 }}>Projects</div>
          {c.projects.map((p, i) => (
            <div key={p.id} style={{ padding: '6px 0', borderBottom: i < c.projects.length - 1 ? '1px solid var(--mx-border)' : 'none' }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 2 }}>
                <StatusBadge tone={STATUS_TONE[p.status]} label={STATUS_LABEL[p.status]} />
                <PriorityBadge tone={PRIORITY_TONE[p.priority]} label={PRIORITY_LABEL[p.priority]} />
              </div>
              <div className={calcStyles.small}>{STAGE_LABEL[p.stage] || p.stage} · Owner: {p.ownerName || '-'} · Created {formatDate(p.createdAt)}</div>
            </div>
          ))}
        </Popover>
      )
    },
    { key: 'owner', header: 'Whose Client', render: (c) => ownerCell(c) },
    {
      key: 'remarks',
      header: 'Remarks',
      render: (c) =>
        c.remarks.length === 0 ? (
          <span className={calcStyles.small}>-</span>
        ) : (
          <Popover ariaLabel="Remarks" trigger={c.remarks[0].length > 40 || c.remarks.length > 1 ? 'View more' : c.remarks[0]}>
            <div className={calcStyles.small} style={{ fontWeight: 700, marginBottom: 8 }}>Remarks</div>
            {c.remarks.map((r, i) => (
              <div key={i} style={{ padding: '6px 0', borderBottom: i < c.remarks.length - 1 ? '1px solid var(--mx-border)' : 'none' }}>{r}</div>
            ))}
          </Popover>
        )
    },
    { key: 'defaultUser', header: 'By Default User ID', render: (c) => defaultUserCell(c) }
  ];
  const columns = allColumns.filter((c) => visibleColumns.has(c.key as ColumnKey));

  return (
    <AppShell title="Client Master" subtitle="Every client across your projects — contact details, ownership, and who's handling which product.">
      <div className={styles.statRow}>
        <StatTile value={kpis.total} label="Total Clients" onClick={() => clearAllFilters()} tone="brand" />
        <StatTile
          value={kpis.withActive}
          label="Clients With Active Projects"
          tone="success"
          active={activeFilter === 'has'}
          onClick={() => setActiveFilter((v) => (v === 'has' ? '' : 'has'))}
        />
        <StatTile
          value={kpis.withoutActive}
          label="No Active Projects"
          tone="warning"
          active={activeFilter === 'none'}
          onClick={() => setActiveFilter((v) => (v === 'none' ? '' : 'none'))}
        />
        <StatTile value={kpis.addedThisMonth} label="Clients Added This Month" tone="info" />
      </div>

      <div className={styles.ownershipToggleRow}>
        {canAddManually && (
          <button type="button" className={calcStyles.btn} onClick={() => setShowAddForm(true)}>+ Add Client</button>
        )}
        <button type="button" className={historyStyles.button} onClick={() => setShowOwnership((v) => !v)}>
          {showOwnership ? 'Hide' : 'Show'} Client Ownership {showOwnership ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        <a className={historyStyles.button} href="/api/clients/export.csv" download>Export CSV</a>
        <button type="button" className={historyStyles.button} onClick={() => setShowColumnMenu((v) => !v)}>Columns</button>
        {showColumnMenu && (
          <div className={styles.columnMenu}>
            {COLUMN_KEYS.map((key) => (
              <label key={key} className={styles.columnMenuItem}>
                <input type="checkbox" checked={visibleColumns.has(key)} onChange={() => toggleColumn(key)} />
                {COLUMN_LABEL[key]}
              </label>
            ))}
          </div>
        )}
      </div>

      {showOwnership && (
        <div className={styles.ownershipPanel}>
          {ownerCounts.length === 0 ? (
            <span className={calcStyles.small}>No client owners found.</span>
          ) : (
            ownerCounts.map((o) => (
              <button
                key={o.username}
                type="button"
                className={styles.ownershipRow}
                onClick={() => {
                  setOwnerFilter((v) => (v === o.username ? '' : o.username));
                  setShowOwnership(false);
                }}
              >
                <span>{o.name}</span>
                <span className={styles.ownershipCount}>{o.count}</span>
              </button>
            ))
          )}
        </div>
      )}

      <FilterBar>
        <input type="text" placeholder="Search clients…" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
        <Select auto value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)}>
          <option value="">All companies</option>
          {distinctCompanies.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
        <Select auto value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}>
          <option value="">All owners</option>
          {distinctOwners.map(([username, name]) => <option key={username} value={username}>{name}</option>)}
        </Select>
        <Select auto value={handlerNameFilter} onChange={(e) => setHandlerNameFilter(e.target.value)}>
          <option value="">All product handlers</option>
          {distinctHandlers.map((h) => <option key={h} value={h}>{h}</option>)}
        </Select>
        <Select auto value={productHandlerFilter} onChange={(e) => setProductHandlerFilter(e.target.value as HandlerFilter)}>
          <option value="">Handler: any</option>
          <option value="has">Has Product Handler</option>
          <option value="none">No Product Handler</option>
        </Select>
        <Input auto type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} title="Created from" />
        <Input auto type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} title="Created to" />
        <Select auto value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
          {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}
        </Select>
        <button type="button" className={historyStyles.button} onClick={() => setSortDesc((v) => !v)}>
          {sortDesc ? '↓ Desc' : '↑ Asc'}
        </button>
      </FilterBar>

      {!loading && !loadFailed && (
        <div className={historyStyles.status}>
          {clients.length ? `${sorted.length} of ${clients.length} client${clients.length === 1 ? '' : 's'} shown.` : ''}
        </div>
      )}

      {loading ? (
        <div className={historyStyles.tableWrap}><SkeletonRows rows={8} columns={columns.length} /></div>
      ) : loadFailed ? (
        <ErrorState message="Could not load the client directory — check your connection and try again." onRetry={load} />
      ) : (
        <>
          <div className={styles.desktopOnly}>
            <Table
              columns={columns}
              rows={pageRows}
              rowKey={(c) => c.key}
              onRowClick={(c) => setDrawerKey(c.key)}
              empty={
                <EmptyState
                  icon={Users}
                  title={clients.length === 0 ? 'No clients yet' : 'No clients match your search'}
                  message={clients.length === 0 ? 'Clients appear here automatically once projects are created — or add one manually below.' : 'Try a different search or filter.'}
                  action={clients.length === 0 && canAddManually ? <button type="button" className={calcStyles.btn} onClick={() => setShowAddForm(true)}>+ Add Client</button> : undefined}
                />
              }
            />
          </div>

          <div className={styles.cardList}>
            {pageRows.length === 0 ? (
              <EmptyState
                icon={Users}
                title={clients.length === 0 ? 'No clients yet' : 'No clients match your search'}
                message={clients.length === 0 ? 'Clients appear here automatically once projects are created — or add one manually below.' : 'Try a different search or filter.'}
                action={clients.length === 0 && canAddManually ? <button type="button" className={calcStyles.btn} onClick={() => setShowAddForm(true)}>+ Add Client</button> : undefined}
              />
            ) : (
              pageRows.map((c) => {
                const primary = c.contacts[0];
                return (
                  <button key={c.key} type="button" className={styles.card} onClick={() => setDrawerKey(c.key)}>
                    <div className={styles.cardCompany}>{c.displayName}</div>
                    <div className={styles.primaryName}>{primary?.clientName || '-'}</div>
                    <div className={calcStyles.small}>{primary?.phone}{primary?.phone && primary?.email ? ' · ' : ''}{primary?.email}</div>
                    <div className={styles.cardMetaRow}>
                      <span>Owner: {ownerCell(c)}</span>
                    </div>
                    <div className={styles.cardMetaRow}>
                      <span>Projects: {c.projectCount}</span>
                      <span>Handlers: {c.productHandlers.length}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          <Pagination page={page} totalPages={totalPages} onChange={setPage} />
        </>
      )}

      {drawerClient && (
        <Drawer title={drawerClient.displayName} ariaLabel={`${drawerClient.displayName} details`} onClose={() => setDrawerKey(null)}>
          <ClientDetailDrawerBody client={drawerClient} />
        </Drawer>
      )}

      {showAddForm && (
        <Drawer title="Add Client" ariaLabel="Add a client manually" onClose={() => setShowAddForm(false)}>
          <form onSubmit={handleAddClient}>
            <Field label="Client Name">
              <Input value={addForm.clientName} onChange={(e) => setAddForm((f) => ({ ...f, clientName: e.target.value }))} autoFocus />
            </Field>
            <Field label="Company">
              <Input value={addForm.company} onChange={(e) => setAddForm((f) => ({ ...f, company: e.target.value }))} />
            </Field>
            <FieldRow>
              <Field label="Phone">
                <PhoneInput value={addForm.phone} onChange={(v) => setAddForm((f) => ({ ...f, phone: v }))} />
              </Field>
              <Field label="Email">
                <Input type="email" value={addForm.email} onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))} />
              </Field>
            </FieldRow>
            <Field label="Address">
              <Input value={addForm.address} onChange={(e) => setAddForm((f) => ({ ...f, address: e.target.value }))} />
            </Field>
            <div className={calcStyles.small} style={{ marginBottom: 12 }}>
              This creates a new project record for this client, owned by you — the same as starting one from the Project Dashboard, just quicker for adding a client to the directory.
            </div>
            <SubmitButton disabled={adding}>{adding ? 'Adding…' : 'Add Client'}</SubmitButton>
          </form>
        </Drawer>
      )}
    </AppShell>
  );
}

function ClientDetailDrawerBody({ client }: { client: ClientSummary }) {
  const primary = client.contacts[0];
  const mostRecentProject = client.projects[0] as ClientProject | undefined;

  return (
    <div className={styles.drawerBody}>
      <section className={styles.drawerSection}>
        <div className={styles.drawerSectionTitle}>Primary Contact</div>
        <div className={styles.primaryName}>{primary?.clientName || '-'}</div>
        {primary?.phone && (isLikelyPhone(primary.phone) ? <a href={`tel:${primary.phone}`}>{primary.phone}</a> : <div>{primary.phone}</div>)}
        {primary?.email && (isLikelyEmail(primary.email) ? <a href={`mailto:${primary.email}`}>{primary.email}</a> : <div>{primary.email}</div>)}
        {client.contacts.length > 1 && (
          <div className={calcStyles.small} style={{ marginTop: 8 }}>
            +{client.contacts.length - 1} more contact{client.contacts.length > 2 ? 's' : ''}
            {client.contacts.slice(1).map((ct, i) => (
              <div key={i} style={{ marginTop: 4 }}>{ct.clientName}{ct.phone ? ` · ${ct.phone}` : ''}{ct.email ? ` · ${ct.email}` : ''}</div>
            ))}
          </div>
        )}
      </section>

      <section className={styles.drawerSection}>
        <div className={styles.drawerSectionTitle}>Client Owner</div>
        {client.owners.length === 0 ? <span className={calcStyles.small}>Unassigned</span> : client.owners.map((o) => <div key={o.id}>{o.name}</div>)}
      </section>

      <section className={styles.drawerSection}>
        <div className={styles.drawerSectionTitle}>Product Handlers</div>
        {client.productHandlers.length === 0 ? (
          <span className={calcStyles.small}>None recorded.</span>
        ) : (
          client.productHandlers.map((h, i) => (
            <div key={i} style={{ marginBottom: 6 }}>
              <div style={{ fontWeight: 600 }}>{h.product}</div>
              <div className={calcStyles.small}>{h.handledBy}</div>
            </div>
          ))
        )}
      </section>

      <section className={styles.drawerSection}>
        <div className={styles.drawerSectionTitle}>Projects ({client.projectCount})</div>
        {client.projects.map((p) => (
          <div key={p.id} style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <StatusBadge tone={STATUS_TONE[p.status]} label={STATUS_LABEL[p.status]} />
              <PriorityBadge tone={PRIORITY_TONE[p.priority]} label={PRIORITY_LABEL[p.priority]} />
            </div>
            <div className={calcStyles.small}>{STAGE_LABEL[p.stage] || p.stage} · Owner: {p.ownerName || '-'} · Created {formatDate(p.createdAt)}</div>
          </div>
        ))}
      </section>

      <section className={styles.drawerSection}>
        <div className={styles.drawerSectionTitle}>Remarks</div>
        {client.remarks.length === 0 ? (
          <span className={calcStyles.small}>None.</span>
        ) : (
          client.remarks.map((r, i) => <div key={i} style={{ marginBottom: 6 }}>{r}</div>)
        )}
      </section>

      <section className={styles.drawerSection}>
        <div className={styles.drawerSectionTitle}>Default User</div>
        {client.owners.length === 0 ? <span className={calcStyles.small}>-</span> : client.owners.map((o) => <div key={o.id}>{o.username}</div>)}
      </section>

      {mostRecentProject && (
        <div className={styles.drawerActions}>
          <Link className={historyStyles.button} href={`/projects/${mostRecentProject.id}`}>Open Client</Link>
          <Link className={historyStyles.button} href={`/projects/${mostRecentProject.id}`}>Edit</Link>
        </div>
      )}
    </div>
  );
}
