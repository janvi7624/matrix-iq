import { ClientMasterRow, CALL_OUTCOME_LABEL } from './clientMasterStore';
import { ProjectStatus } from './types';

// Server-side filter / search / sort / paginate for Client Master.
//
// The directory itself is derived — it is rebuilt from projects, their
// quotations' line items and leads on every call (see clientMasterStore) —
// so the expensive part happens server-side either way. What this saves is
// shipping the WHOLE directory to the browser: 1343 rows / ~1.27 MB on every
// load, when the table shows 20 at a time. Paginated, the same screen costs
// about 20 kB.
//
// Every predicate below is a deliberate copy of what
// components/ClientMasterView.tsx used to do in the browser, including the
// awkward parts (outcome requiring leadCount > 0; 'has/none active project'
// excluding prospects entirely; the search haystack reaching into contacts,
// handlers, owners and project STATUS LABELS rather than raw values). It is
// kept here as one pure, testable function precisely so the two cannot
// quietly disagree — a filter that behaves differently on the server than it
// did in the browser is a silent data-visibility bug, not a cosmetic one.

const STATUS_LABEL: Record<ProjectStatus, string> = { active: 'Active', on_hold: 'On Hold', won: 'Won', lost: 'Lost' };

export type ClientSortKey = 'name' | 'company' | 'owner' | 'projects' | 'created' | 'updated';

export interface ClientMasterQuery {
  search?: string;
  company?: string;
  owner?: string;
  handlerName?: string;
  type?: ClientRowTypeFilter;
  outcome?: string;
  /** 'has' | 'none' — customers with / without an active project. */
  active?: string;
  /** 'has' | 'none' — rows with / without a product handler. */
  handler?: string;
  dateFrom?: string;
  dateTo?: string;
  sortKey?: ClientSortKey;
  sortDesc?: boolean;
  page?: number;
  pageSize?: number;
  /**
   * false skips the dropdown option lists. They are identical on every
   * request and the company list alone is 1343 names (~30kB), so the screen
   * asks for them once on mount and never again.
   */
  withOptions?: boolean;
}

type ClientRowTypeFilter = 'customer' | 'prospect' | '';

export interface ClientMasterStats {
  totalClients: number;
  customers: number;
  prospects: number;
  withActiveProject: number;
  withHandlers: number;
  addedThisMonth: number;
}

export interface ClientMasterOptions {
  companies: string[];
  /** Every owner in the directory, with how many rows they own. The
   * Ownership panel needs the count across ALL clients, not the current
   * page — "Prashant: 198" has to mean 198. */
  owners: { username: string; name: string; count: number }[];
  handlers: string[];
}

export interface ClientMasterPage {
  clients: ClientMasterRow[];
  total: number;
  page: number;
  pageSize: number;
  stats: ClientMasterStats;
  options?: ClientMasterOptions;
}

const isProspect = (c: ClientMasterRow): boolean => c.type === 'prospect';
const typeLabel = (c: ClientMasterRow): string => (isProspect(c) ? 'Prospect' : 'Customer');
const hasActiveProject = (c: ClientMasterRow): boolean => (c.statusCounts.active || 0) > 0;

function isThisMonth(iso: string, now: Date): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

/** Exactly the haystack the browser used to build, in the same order. */
function searchHaystack(c: ClientMasterRow): string[] {
  return [
    c.displayName,
    typeLabel(c),
    c.callOutcome ? CALL_OUTCOME_LABEL[c.callOutcome] : '',
    ...c.contacts.flatMap((ct) => [ct.clientName, ct.phone, ct.email, ct.altContactName, ct.altContactPhone]),
    ...c.productHandlers.flatMap((h) => [h.product, h.handledBy]),
    ...c.owners.flatMap((o) => [o.name, o.username]),
    ...c.projects.map((p) => STATUS_LABEL[p.status])
  ];
}

export function filterClients(clients: ClientMasterRow[], q: ClientMasterQuery): ClientMasterRow[] {
  const search = (q.search || '').trim().toLowerCase();
  return clients.filter((c) => {
    if (q.company && c.displayName !== q.company) return false;
    if (q.owner && !c.owners.some((o) => o.username === q.owner)) return false;
    if (q.handlerName && !c.productHandlers.some((h) => h.product === q.handlerName)) return false;
    if (q.type && c.type !== q.type) return false;
    if (q.outcome) {
      // A row with no lead behind it has no outcome to match — including the
      // "not called yet" option, which means "has a lead, nobody rang it".
      if (c.leadCount === 0) return false;
      if (q.outcome === 'not_called' ? c.callOutcome !== '' : c.callOutcome !== q.outcome) return false;
    }
    // Both project filters are about CUSTOMERS — a prospect has no project to
    // be active or inactive, so it belongs to neither bucket.
    if (q.active === 'has' && (isProspect(c) || !hasActiveProject(c))) return false;
    if (q.active === 'none' && (isProspect(c) || hasActiveProject(c))) return false;
    if (q.handler === 'has' && c.productHandlers.length === 0) return false;
    if (q.handler === 'none' && c.productHandlers.length > 0) return false;
    if (q.dateFrom && (!c.createdAt || c.createdAt.slice(0, 10) < q.dateFrom)) return false;
    if (q.dateTo && (!c.createdAt || c.createdAt.slice(0, 10) > q.dateTo)) return false;
    if (search && !searchHaystack(c).some((v) => (v || '').toLowerCase().includes(search))) return false;
    return true;
  });
}

export function sortClients(list: ClientMasterRow[], sortKey: ClientSortKey = 'updated', sortDesc = true): ClientMasterRow[] {
  const dir = sortDesc ? -1 : 1;
  return [...list].sort((a, b) => {
    switch (sortKey) {
      case 'name': return dir * (a.contacts[0]?.clientName || '').localeCompare(b.contacts[0]?.clientName || '');
      case 'company': return dir * a.displayName.localeCompare(b.displayName);
      case 'owner': return dir * (a.owners[0]?.name || '').localeCompare(b.owners[0]?.name || '');
      case 'projects': return dir * (a.projectCount - b.projectCount);
      case 'created': return dir * (a.createdAt || '').localeCompare(b.createdAt || '');
      case 'updated':
      default: return dir * (a.updatedAt || '').localeCompare(b.updatedAt || '');
    }
  });
}

/**
 * Summary tiles and dropdown options are computed from the WHOLE directory,
 * never the current page — "216 customers" has to mean 216 customers, not
 * "however many happen to be on screen", and the company dropdown has to
 * offer every company or it cannot be used to find one.
 */
export function buildStats(clients: ClientMasterRow[], now: Date = new Date()): ClientMasterStats {
  return {
    totalClients: clients.length,
    customers: clients.filter((c) => !isProspect(c)).length,
    prospects: clients.filter(isProspect).length,
    withActiveProject: clients.filter((c) => !isProspect(c) && hasActiveProject(c)).length,
    withHandlers: clients.filter((c) => c.productHandlers.length > 0).length,
    addedThisMonth: clients.filter((c) => isThisMonth(c.createdAt, now)).length
  };
}

export function buildOptions(clients: ClientMasterRow[]): ClientMasterOptions {
  const ownerByUsername = new Map<string, { name: string; count: number }>();
  clients.forEach((c) => c.owners.forEach((o) => {
    const entry = ownerByUsername.get(o.username) || { name: o.name, count: 0 };
    entry.count += 1;
    ownerByUsername.set(o.username, entry);
  }));
  return {
    companies: [...new Set(clients.map((c) => c.displayName))].sort(),
    // Sorted by NAME here because that is what the filter dropdown wants;
    // the Ownership panel re-sorts by count itself.
    owners: [...ownerByUsername.entries()].map(([username, v]) => ({ username, name: v.name, count: v.count })).sort((a, b) => a.name.localeCompare(b.name)),
    handlers: [...new Set(clients.flatMap((c) => c.productHandlers.map((h) => h.product)))].sort()
  };
}

export function paginateClients(clients: ClientMasterRow[], q: ClientMasterQuery, now: Date = new Date()): ClientMasterPage {
  const stats = buildStats(clients, now);
  const options = q.withOptions === false ? undefined : buildOptions(clients);
  const matched = sortClients(filterClients(clients, q), q.sortKey, q.sortDesc);
  const pageSize = Math.max(1, Math.min(200, q.pageSize || 20));
  const totalPages = Math.max(1, Math.ceil(matched.length / pageSize));
  // Clamped rather than returning an empty page: narrowing a filter while on
  // page 9 of 12 used to leave the table blank with no way back.
  const page = Math.min(Math.max(1, q.page || 1), totalPages);
  const start = (page - 1) * pageSize;
  return { clients: matched.slice(start, start + pageSize), total: matched.length, page, pageSize, stats, options };
}
