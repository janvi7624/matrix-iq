import { Op } from 'sequelize';
import { db } from './db';
import { resolveVisibilityScope } from './departmentScope';
import {
  BillingRow,
  BillingTotals,
  OwnerBillingSummary,
  mergeDeals,
  summariseBilling,
  summariseBillingByOwner
} from './billingSummary';

// The data behind the Billing view: won deals and the agreed work behind them.
//
// Scoping is the existing resolveVisibilityScope, unchanged, which already
// means exactly what was asked for — a salesperson sees their own deals, a
// department manager sees their whole team, and a viewAllDepartments role sees
// everything. Reusing it also means Billing can never disagree with the
// Projects list about who may see a deal.
//
// The fold from records to deals lives in lib/billingSummary.ts; this file only
// fetches and scopes.

export interface BillingFilters {
  /** Inclusive IST date bounds on when the deal closed. */
  from?: string;
  to?: string;
  /** Narrow to one salesperson, within the viewer's scope. */
  owner?: string;
  query?: string;
}

export interface BillingResponse {
  rows: BillingRow[];
  totals: BillingTotals;
  byOwner: OwnerBillingSummary[];
  /** So the UI can say whose figures these are. */
  scope: 'own' | 'team' | 'org';
  /** Salespeople the viewer may filter by — their scope, not everyone. */
  owners: string[];
}

function dateOnly(value: unknown): string {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function decimal(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function getBilling(viewerUsername: string, filters: BillingFilters = {}): Promise<BillingResponse> {
  const scope = await resolveVisibilityScope(viewerUsername);

  // A null scopedUserIds means org-wide; otherwise constrain on the owner of
  // the record, which for both projects and quotations is created_by.
  const ownerWhere = scope.scopedUserIds ? { created_by: { [Op.in]: scope.scopedUserIds } } : {};

  const [projectRows, quotationRows] = await Promise.all([
    db.Project.findAll({
      where: { status: 'won', ...ownerWhere } as never,
      include: [{ model: db.User, as: 'creator', attributes: ['id', 'username'] }] as never,
      order: [['closed_at', 'DESC']]
    }),
    db.Quotation.findAll({
      where: { status: 'approved', ...ownerWhere } as never,
      include: [{ model: db.User, as: 'creator', attributes: ['id', 'username'] }] as never,
      // Oldest first, so mergeDeals' last-wins rule lands on the newest
      // approved quotation when a project has more than one.
      order: [['revision_number', 'ASC'], ['created_at', 'ASC']]
    })
  ]);

  const projects = projectRows.map((row) => row.get({ plain: true }) as Record<string, unknown>);
  const quotations = quotationRows.map((row) => row.get({ plain: true }) as Record<string, unknown>);

  // One query for every PO on the won projects, rather than one per project.
  const projectIds = projects.map((p) => String(p.id));
  const poByProject = new Map<string, { amount: number | null; number: string }>();
  if (projectIds.length) {
    const poRows = await db.PurchaseOrder.findAll({
      where: { project_id: { [Op.in]: projectIds } } as never,
      order: [['po_date', 'ASC']]
    });
    for (const row of poRows) {
      const plain = row.get({ plain: true }) as Record<string, unknown>;
      const key = String(plain.project_id);
      const existing = poByProject.get(key);
      const amount = decimal(plain.amount);
      // Several POs against one project are summed: they are all orders
      // against the same deal, and billing wants the whole of it.
      poByProject.set(key, {
        amount: (existing?.amount ?? 0) + (amount ?? 0),
        number: existing?.number ? `${existing.number}, ${String(plain.po_number ?? '')}` : String(plain.po_number ?? '')
      });
    }
  }

  const rows = mergeDeals(
    projects.map((p) => {
      const po = poByProject.get(String(p.id));
      return {
        id: String(p.id),
        label: String(p.project_name || p.client_name || '') || 'Untitled project',
        clientName: String(p.client_name ?? ''),
        company: String(p.company ?? ''),
        ownerUsername: (p.creator as { username?: string } | null)?.username ?? '',
        closedOn: dateOnly(p.closed_at),
        approxPrice: decimal(p.approx_price),
        poValue: po ? po.amount : null,
        poNumber: po ? po.number : ''
      };
    }),
    quotations.map((q) => ({
      id: String(q.id),
      projectId: q.project_id ? String(q.project_id) : '',
      quotationNumber: String(q.quotation_number ?? ''),
      total: decimal(q.total),
      clientName: String(q.client_name ?? ''),
      company: String(q.client_company ?? ''),
      ownerUsername: (q.creator as { username?: string } | null)?.username ?? '',
      closedOn: dateOnly(q.status_changed_at) || dateOnly(q.created_at)
    }))
  );

  const owners = [...new Set(rows.map((r) => r.ownerUsername).filter(Boolean))].sort();

  // Filters are applied AFTER the fold, so narrowing by date or salesperson
  // can never split a deal away from its own quotation.
  const q = (filters.query ?? '').trim().toLowerCase();
  const filtered = rows.filter((row) => {
    if (filters.owner && row.ownerUsername !== filters.owner) return false;
    // A deal with no close date is kept out of a date-bounded view rather
    // than guessed into it.
    if (filters.from && (!row.closedOn || row.closedOn < filters.from)) return false;
    if (filters.to && (!row.closedOn || row.closedOn > filters.to)) return false;
    if (q) {
      const haystack = [row.label, row.clientName, row.company, row.quotationNumber, row.poNumber]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  return {
    rows: filtered,
    totals: summariseBilling(filtered),
    byOwner: summariseBillingByOwner(filtered),
    scope: scope.seesOrgWide ? 'org' : (scope.scopedUserIds?.length ?? 0) > 1 ? 'team' : 'own',
    owners
  };
}
