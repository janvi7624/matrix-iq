import { Model, Op } from 'sequelize';
import { QuotationEffectiveStatus, QuotationRecord, QuotationStatus } from './types';
import { computeQuotationPrefix, formatQuotationNumber } from './quotationNumber';
import { DomainKey } from './types';
import { db, isUuid } from './db';
import { resolveVisibilityScope } from './departmentScope';

const UNKNOWN_USER_ID = '00000000-0000-0000-0000-000000000000';

function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

const QUOTATION_INCLUDE = [
  { model: db.User, as: 'creator', attributes: ['id', 'username'] },
  {
    model: db.QuotationFollowUp,
    as: 'followUps',
    include: [{ model: db.User, as: 'creator', attributes: ['username'] }],
    separate: true,
    order: [['created_at', 'ASC']]
  }
];

function toRecord(row: Model): QuotationRecord {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const followUps = ((plain.followUps as Record<string, unknown>[]) ?? []).map((fu) => ({
    at: isoOrEmpty(fu.created_at),
    by: (fu.creator as { username?: string } | null)?.username ?? '',
    note: (fu.note as string) ?? ''
  }));

  return {
    id: plain.id as string,
    quotation_number: (plain.quotation_number as string) ?? '',
    created_at: isoOrEmpty(plain.createdAt),
    project_id: (plain.project_id as string) ?? '',
    created_by: (plain.creator as { username?: string } | null)?.username ?? '',
    status: plain.status as QuotationStatus,
    prepared_by: (plain.prepared_by as string) ?? '',
    prepared_by_phone: (plain.prepared_by_phone as string) ?? '',
    prepared_by_email: (plain.prepared_by_email as string) ?? '',
    client_name: (plain.client_name as string) ?? '',
    client_company: (plain.client_company as string) ?? '',
    client_email: (plain.client_email as string) ?? '',
    client_phone: (plain.client_phone as string) ?? '',
    client_address: (plain.client_address as string) ?? '',
    project_vertical: (plain.project_vertical as string) ?? '',
    domain_summary: (plain.domain_summary as string) ?? '',
    products_summary: (plain.products_summary as string) ?? '',
    products_json: JSON.stringify(plain.products_json ?? []),
    subtotal: Number(plain.subtotal ?? 0),
    markup_percent: Number(plain.markup_percent ?? 0),
    discount_total: Number(plain.discount_total ?? 0),
    gst_amount: Number(plain.gst_amount ?? 0),
    total: Number(plain.total ?? 0),
    validity_days: Number(plain.validity_days ?? 0),
    last_follow_up_at: isoOrEmpty(plain.last_follow_up_at),
    follow_up_notes_json: JSON.stringify(followUps),
    original_quotation_id: (plain.original_quotation_id as string) ?? '',
    revision_number: Number(plain.revision_number ?? 0),
    revision_reason: (plain.revision_reason as string) ?? ''
  };
}

export interface CreateQuotationInput {
  prefix?: string;
  projectId?: string;
  createdBy?: string;
  domains?: DomainKey[];
  preparedBy?: string;
  preparedByPhone?: string;
  preparedByEmail?: string;
  clientName?: string;
  clientCompany?: string;
  clientEmail?: string;
  clientPhone?: string;
  clientAddress?: string;
  projectVertical?: string;
  domainSummary?: string;
  productsSummary?: string;
  products?: unknown;
  subtotal?: number;
  markupPercent?: number;
  discountTotal?: number;
  gstAmount?: number;
  total?: number;
  validityDays?: number;
}

async function nextQuotationNumber(prefix: string, now: Date): Promise<string> {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();

  const existingRows = await db.Quotation.findAll({ attributes: ['quotation_number'] });
  const existingNumbers = new Set(existingRows.map((r) => r.get('quotation_number') as string));
  const sequencePattern = new RegExp(`^NT-${prefix}-${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}/(\\d+)$`);
  let sequence =
    [...existingNumbers].reduce((max, num) => {
      const match = num.match(sequencePattern);
      return match ? Math.max(max, parseInt(match[1], 10)) : max;
    }, 0) + 1;

  let quotationNumber = formatQuotationNumber(prefix, year, month, day, sequence);
  while (existingNumbers.has(quotationNumber)) {
    sequence += 1;
    quotationNumber = formatQuotationNumber(prefix, year, month, day, sequence);
  }
  return quotationNumber;
}

export async function createQuotation(input: CreateQuotationInput): Promise<QuotationRecord> {
  const now = new Date();
  const prefix = input.prefix || computeQuotationPrefix(input.domains || []);
  const quotationNumber = await nextQuotationNumber(prefix, now);
  const creator = input.createdBy ? await db.User.findOne({ where: { username: input.createdBy } as never }) : null;

  const row = await db.Quotation.create({
    quotation_number: quotationNumber,
    project_id: input.projectId || null,
    created_by: creator ? creator.get('id') : null,
    status: 'sent',
    prepared_by: input.preparedBy || '',
    prepared_by_phone: input.preparedByPhone || '',
    prepared_by_email: input.preparedByEmail || '',
    client_name: input.clientName || '',
    client_company: input.clientCompany || '',
    client_email: input.clientEmail || '',
    client_phone: input.clientPhone || '',
    client_address: input.clientAddress || '',
    project_vertical: input.projectVertical || '',
    domain_summary: input.domainSummary || '',
    products_summary: input.productsSummary || '',
    products_json: input.products || [],
    subtotal: Number(input.subtotal) || 0,
    markup_percent: Number(input.markupPercent) || 0,
    discount_total: Number(input.discountTotal) || 0,
    gst_amount: Number(input.gstAmount) || 0,
    total: Number(input.total) || 0,
    validity_days: Number(input.validityDays) || 7,
    last_follow_up_at: null,
    original_quotation_id: null,
    revision_number: 0,
    revision_reason: ''
  } as never);

  return (await findQuotationById(row.get('id') as string)) as QuotationRecord;
}

// Creates a new, independent QuotationRecord linked back to the ORIGINAL
// (root) quotation — the original itself is never mutated. Numbered
// QT-00123 -> QT-00123.01 -> QT-00123.02 off the root's own quotation_number,
// regardless of which existing version the revision was made from.
export async function createQuotationRevision(sourceId: string, input: CreateQuotationInput, reason: string): Promise<QuotationRecord | null> {
  if (!isUuid(sourceId)) return null;
  const source = await db.Quotation.findByPk(sourceId);
  if (!source) return null;
  const sourcePlain = source.get({ plain: true }) as Record<string, unknown>;
  const rootId = (sourcePlain.original_quotation_id as string) || (sourcePlain.id as string);
  const root = await db.Quotation.findByPk(rootId);
  if (!root) return null;
  const rootPlain = root.get({ plain: true }) as Record<string, unknown>;

  const revisionCount = await db.Quotation.count({ where: { original_quotation_id: rootId } as never });
  const nextRevisionNumber = revisionCount + 1;
  const quotationNumber = `${rootPlain.quotation_number}.${String(nextRevisionNumber).padStart(2, '0')}`;
  const creator = input.createdBy ? await db.User.findOne({ where: { username: input.createdBy } as never }) : null;

  const row = await db.Quotation.create({
    quotation_number: quotationNumber,
    project_id: input.projectId ?? rootPlain.project_id,
    created_by: creator ? creator.get('id') : null,
    status: 'sent',
    prepared_by: input.preparedBy ?? rootPlain.prepared_by,
    prepared_by_phone: input.preparedByPhone ?? rootPlain.prepared_by_phone,
    prepared_by_email: input.preparedByEmail ?? rootPlain.prepared_by_email,
    client_name: input.clientName ?? rootPlain.client_name,
    client_company: input.clientCompany ?? rootPlain.client_company,
    client_email: input.clientEmail ?? rootPlain.client_email,
    client_phone: input.clientPhone ?? rootPlain.client_phone,
    client_address: input.clientAddress ?? rootPlain.client_address,
    project_vertical: input.projectVertical ?? rootPlain.project_vertical,
    domain_summary: input.domainSummary ?? rootPlain.domain_summary,
    products_summary: input.productsSummary ?? rootPlain.products_summary,
    products_json: input.products !== undefined ? input.products : rootPlain.products_json,
    subtotal: input.subtotal !== undefined ? Number(input.subtotal) || 0 : rootPlain.subtotal,
    markup_percent: input.markupPercent !== undefined ? Number(input.markupPercent) || 0 : rootPlain.markup_percent,
    discount_total: input.discountTotal !== undefined ? Number(input.discountTotal) || 0 : rootPlain.discount_total,
    gst_amount: input.gstAmount !== undefined ? Number(input.gstAmount) || 0 : rootPlain.gst_amount,
    total: input.total !== undefined ? Number(input.total) || 0 : rootPlain.total,
    validity_days: input.validityDays !== undefined ? Number(input.validityDays) || 7 : rootPlain.validity_days,
    last_follow_up_at: null,
    original_quotation_id: rootId,
    revision_number: nextRevisionNumber,
    revision_reason: reason
  } as never);

  return (await findQuotationById(row.get('id') as string)) ?? null;
}

// Every version of one quotation — the root plus every revision — oldest
// first, so a version-history table reads top-to-bottom in creation order.
export async function listQuotationVersions(anyVersionId: string): Promise<QuotationRecord[]> {
  if (!isUuid(anyVersionId)) return [];
  const anyVersion = await db.Quotation.findByPk(anyVersionId);
  if (!anyVersion) return [];
  const anyPlain = anyVersion.get({ plain: true }) as Record<string, unknown>;
  const rootId = (anyPlain.original_quotation_id as string) || (anyPlain.id as string);

  const rows = await db.Quotation.findAll({
    where: { [Op.or]: [{ id: rootId }, { original_quotation_id: rootId }] } as never,
    include: QUOTATION_INCLUDE as never,
    order: [['revision_number', 'ASC']]
  });
  return rows.map(toRecord);
}

export async function logQuotationFollowUp(id: string, by: string, note: string): Promise<QuotationRecord | null> {
  if (!isUuid(id)) return null;
  const row = await db.Quotation.findByPk(id);
  if (!row) return null;
  const creator = await db.User.findOne({ where: { username: by } as never });
  const now = new Date();
  await db.QuotationFollowUp.create({ quotation_id: id, note, created_by: creator ? creator.get('id') : null } as never);
  await row.update({ last_follow_up_at: now } as never);
  return (await findQuotationById(id)) ?? null;
}

export async function findQuotationById(id: string): Promise<QuotationRecord | undefined> {
  if (!isUuid(id)) return undefined;
  const row = await db.Quotation.findByPk(id, { include: QUOTATION_INCLUDE as never });
  return row ? toRecord(row) : undefined;
}

export async function deleteQuotation(id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const row = await db.Quotation.findByPk(id);
  if (!row) return false;
  await row.destroy();
  return true;
}

export async function updateQuotationStatus(id: string, status: QuotationStatus): Promise<QuotationRecord | null> {
  if (!isUuid(id)) return null;
  const row = await db.Quotation.findByPk(id);
  if (!row) return null;
  await row.update({ status } as never);
  return (await findQuotationById(id)) ?? null;
}

// 'sent' quotations past their validity window read as 'expired' everywhere
// (stats, filters, badges) without a stored value or background job — the
// persisted `status` only changes on an explicit user action.
export function computeEffectiveStatus(record: QuotationRecord): QuotationEffectiveStatus {
  if (record.status === 'sent') {
    const createdAt = new Date(record.created_at).getTime();
    if (!Number.isNaN(createdAt)) {
      const expiresAt = createdAt + (record.validity_days || 0) * 24 * 60 * 60 * 1000;
      if (Date.now() > expiresAt) return 'expired';
    }
  }
  return record.status;
}

export interface QuotationFilters {
  query?: string;
  // Narrows to exactly this one user's quotations — for an admin-facing
  // per-user lookup (Activity, Performance Review, the salesPerson filter
  // on the admin Quotations console), not for "what can the CURRENT viewer
  // see". Combines with viewerUsername below when both are given: the
  // result is still clamped to the viewer's own scope, so this can't be
  // used to reach into another department's quotations by owner id.
  ownerUsername?: string;
  // The CURRENT viewer — when set, department-scopes the result to what
  // they're allowed to see (org-wide, or own + managed department's team).
  // See lib/departmentScope.ts.
  viewerUsername?: string;
  status?: QuotationEffectiveStatus;
  projectId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export async function searchQuotationsFiltered(filters: QuotationFilters): Promise<QuotationRecord[]> {
  const andConditions: Record<string | symbol, unknown>[] = [];

  if (filters.ownerUsername) {
    const user = await db.User.findOne({
      where: {
        [Op.or]: [
          { username: filters.ownerUsername },
          { name: filters.ownerUsername }
        ]
      } as never
    });
    if (user) {
      andConditions.push({
        [Op.or]: [
          { created_by: user.get('id') },
          { prepared_by: filters.ownerUsername },
          { prepared_by: user.get('name') }
        ]
      });
    } else {
      andConditions.push({
        [Op.or]: [
          { prepared_by: filters.ownerUsername },
          { created_by: '00000000-0000-0000-0000-000000000000' }
        ]
      });
    }
  }

  // Clamps to the viewer's own department scope — org-wide for
  // Admin/Super Admin (or any role with viewAllDepartments), otherwise the
  // viewer's own quotations plus their managed department's team, otherwise
  // own-only. AND'd with ownerUsername above (never OR'd), so the
  // salesPerson filter can only narrow within this scope, not widen past it.
  if (filters.viewerUsername) {
    const scope = await resolveVisibilityScope(filters.viewerUsername);
    if (!scope.seesOrgWide) {
      andConditions.push({ created_by: { [Op.in]: scope.scopedUserIds ?? [] } });
    }
  }

  if (filters.projectId) andConditions.push({ project_id: filters.projectId });

  const where: Record<string | symbol, unknown> = andConditions.length ? { [Op.and]: andConditions } : {};

  const rows = await db.Quotation.findAll({ where: where as never, include: QUOTATION_INCLUDE as never, order: [['created_at', 'DESC']] });
  let records = rows.map(toRecord);

  if (filters.status) records = records.filter((r) => computeEffectiveStatus(r) === filters.status);
  if (filters.dateFrom) records = records.filter((r) => r.created_at.slice(0, 10) >= filters.dateFrom!);
  if (filters.dateTo) records = records.filter((r) => r.created_at.slice(0, 10) <= filters.dateTo!);
  if (filters.query && filters.query.trim()) {
    const q = filters.query.trim().toLowerCase();
    records = records.filter((r) =>
      [r.quotation_number, r.prepared_by, r.created_by, r.client_name, r.client_company, r.project_vertical]
        .filter(Boolean)
        .some((field) => field.toLowerCase().includes(q))
    );
  }
  return records;
}

export async function searchQuotations(query?: string): Promise<QuotationRecord[]> {
  return searchQuotationsFiltered({ query });
}

// Lightweight count for the Dashboard KPI row — avoids loading every
// quotation's full row + creator + follow-up includes just to count how many
// belong to the viewer's own projects.
export async function countQuotationsForProjects(projectIds: string[]): Promise<number> {
  if (!projectIds.length) return 0;
  return db.Quotation.count({ where: { project_id: { [Op.in]: projectIds } } as never });
}

const CSV_COLUMNS: { key: keyof QuotationRecord; header: string }[] = [
  { key: 'quotation_number', header: 'Quotation Number' },
  { key: 'created_at', header: 'Date' },
  { key: 'project_id', header: 'Project ID' },
  { key: 'created_by', header: 'Created By (username)' },
  { key: 'status', header: 'Status' },
  { key: 'prepared_by', header: 'Prepared By' },
  { key: 'prepared_by_phone', header: 'Prepared By Phone' },
  { key: 'prepared_by_email', header: 'Prepared By Email' },
  { key: 'client_name', header: 'Client Name' },
  { key: 'client_company', header: 'Client Company' },
  { key: 'client_email', header: 'Client Email' },
  { key: 'client_phone', header: 'Client Phone' },
  { key: 'project_vertical', header: 'Project Vertical' },
  { key: 'domain_summary', header: 'Domain' },
  { key: 'products_summary', header: 'Products' },
  { key: 'subtotal', header: 'Subtotal' },
  { key: 'markup_percent', header: 'Markup %' },
  { key: 'discount_total', header: 'Discount' },
  { key: 'gst_amount', header: 'GST' },
  { key: 'total', header: 'Total' },
  { key: 'validity_days', header: 'Validity (days)' },
  { key: 'last_follow_up_at', header: 'Last Follow-Up' }
];

function csvEscape(value: unknown): string {
  const str = String(value ?? '');
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export async function buildQuotationsCsv(): Promise<string> {
  const records = await searchQuotations();
  const header = CSV_COLUMNS.map((c) => csvEscape(c.header)).join(',');
  const rows = records.map((r) => CSV_COLUMNS.map((c) => csvEscape(r[c.key])).join(','));
  return [header, ...rows].join('\r\n') + '\r\n';
}
