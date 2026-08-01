import { QuotationEffectiveStatus, QuotationRecord, QuotationStatus } from './types';
import { computeQuotationPrefix, formatQuotationNumber } from './quotationNumber';
import { DomainKey } from './types';
import { readJsonBlob, writeJsonBlob } from './blobStore';

const DATA_PATHNAME = 'data/quotations.json';

// Records written before versioning existed won't have these fields in blob
// storage — default them to "original, unversioned" so every reader (list,
// revise, version-history) can rely on them always being present.
function normalizeQuotation(record: QuotationRecord): QuotationRecord {
  return {
    ...record,
    original_quotation_id: record.original_quotation_id ?? '',
    revision_number: record.revision_number ?? 0,
    revision_reason: record.revision_reason ?? ''
  };
}

async function readQuotations(): Promise<QuotationRecord[]> {
  const records = await readJsonBlob<QuotationRecord[]>(DATA_PATHNAME, []);
  return records.map(normalizeQuotation);
}

async function writeQuotations(records: QuotationRecord[]): Promise<void> {
  await writeJsonBlob(DATA_PATHNAME, records);
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

export async function createQuotation(input: CreateQuotationInput): Promise<QuotationRecord> {
  const records = await readQuotations();
  const now = new Date();
  const prefix = input.prefix || computeQuotationPrefix(input.domains || []);
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();

  const existingNumbers = new Set(records.map((r) => r.quotation_number));
  const sequencePattern = new RegExp(`^NT-${prefix}-${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}/(\\d+)$`);
  let sequence = records.reduce((max, r) => {
    const match = r.quotation_number.match(sequencePattern);
    return match ? Math.max(max, parseInt(match[1], 10)) : max;
  }, 0) + 1;

  let quotationNumber = formatQuotationNumber(prefix, year, month, day, sequence);
  while (existingNumbers.has(quotationNumber)) {
    sequence += 1;
    quotationNumber = formatQuotationNumber(prefix, year, month, day, sequence);
  }

  const record: QuotationRecord = {
    id: `${now.getTime()}`,
    quotation_number: quotationNumber,
    created_at: now.toISOString(),
    project_id: input.projectId || '',
    created_by: input.createdBy || '',
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
    products_json: JSON.stringify(input.products || []),
    subtotal: Number(input.subtotal) || 0,
    markup_percent: Number(input.markupPercent) || 0,
    discount_total: Number(input.discountTotal) || 0,
    gst_amount: Number(input.gstAmount) || 0,
    total: Number(input.total) || 0,
    validity_days: Number(input.validityDays) || 7,
    last_follow_up_at: '',
    follow_up_notes_json: '[]',
    original_quotation_id: '',
    revision_number: 0,
    revision_reason: ''
  };

  records.push(record);
  await writeQuotations(records);
  return record;
}

// Creates a new, independent QuotationRecord linked back to the ORIGINAL
// (root) quotation — the original itself is never mutated. Numbered
// QT-00123 -> QT-00123.01 -> QT-00123.02 off the root's own quotation_number,
// regardless of which existing version the revision was made from.
export async function createQuotationRevision(sourceId: string, input: CreateQuotationInput, reason: string): Promise<QuotationRecord | null> {
  const records = await readQuotations();
  const source = records.find((r) => r.id === sourceId);
  if (!source) return null;
  const rootId = source.original_quotation_id || source.id;
  const root = records.find((r) => r.id === rootId);
  if (!root) return null;

  const nextRevisionNumber = records.filter((r) => r.original_quotation_id === rootId).length + 1;
  const quotationNumber = `${root.quotation_number}.${String(nextRevisionNumber).padStart(2, '0')}`;
  const now = new Date();

  const record: QuotationRecord = {
    id: `${now.getTime()}`,
    quotation_number: quotationNumber,
    created_at: now.toISOString(),
    project_id: input.projectId ?? root.project_id,
    created_by: input.createdBy || '',
    status: 'sent',
    prepared_by: input.preparedBy ?? root.prepared_by,
    prepared_by_phone: input.preparedByPhone ?? root.prepared_by_phone,
    prepared_by_email: input.preparedByEmail ?? root.prepared_by_email,
    client_name: input.clientName ?? root.client_name,
    client_company: input.clientCompany ?? root.client_company,
    client_email: input.clientEmail ?? root.client_email,
    client_phone: input.clientPhone ?? root.client_phone,
    client_address: input.clientAddress ?? root.client_address,
    project_vertical: input.projectVertical ?? root.project_vertical,
    domain_summary: input.domainSummary ?? root.domain_summary,
    products_summary: input.productsSummary ?? root.products_summary,
    products_json: input.products !== undefined ? JSON.stringify(input.products) : root.products_json,
    subtotal: input.subtotal !== undefined ? Number(input.subtotal) || 0 : root.subtotal,
    markup_percent: input.markupPercent !== undefined ? Number(input.markupPercent) || 0 : root.markup_percent,
    discount_total: input.discountTotal !== undefined ? Number(input.discountTotal) || 0 : root.discount_total,
    gst_amount: input.gstAmount !== undefined ? Number(input.gstAmount) || 0 : root.gst_amount,
    total: input.total !== undefined ? Number(input.total) || 0 : root.total,
    validity_days: input.validityDays !== undefined ? Number(input.validityDays) || 7 : root.validity_days,
    last_follow_up_at: '',
    follow_up_notes_json: '[]',
    original_quotation_id: rootId,
    revision_number: nextRevisionNumber,
    revision_reason: reason
  };

  records.push(record);
  await writeQuotations(records);
  return record;
}

// Every version of one quotation — the root plus every revision — oldest
// first, so a version-history table reads top-to-bottom in creation order.
export async function listQuotationVersions(anyVersionId: string): Promise<QuotationRecord[]> {
  const records = await readQuotations();
  const anyVersion = records.find((r) => r.id === anyVersionId);
  if (!anyVersion) return [];
  const rootId = anyVersion.original_quotation_id || anyVersion.id;
  return records
    .filter((r) => r.id === rootId || r.original_quotation_id === rootId)
    .sort((a, b) => a.revision_number - b.revision_number);
}

export async function logQuotationFollowUp(id: string, by: string, note: string): Promise<QuotationRecord | null> {
  const records = await readQuotations();
  const index = records.findIndex((r) => r.id === id);
  if (index === -1) return null;

  const existing = records[index];
  let notes: unknown[] = [];
  try {
    const parsed = JSON.parse(existing.follow_up_notes_json || '[]');
    notes = Array.isArray(parsed) ? parsed : [];
  } catch {
    notes = [];
  }
  const at = new Date().toISOString();
  notes.push({ at, by, note });

  const updated: QuotationRecord = { ...existing, last_follow_up_at: at, follow_up_notes_json: JSON.stringify(notes) };
  records[index] = updated;
  await writeQuotations(records);
  return updated;
}

export async function findQuotationById(id: string): Promise<QuotationRecord | undefined> {
  const records = await readQuotations();
  return records.find((r) => r.id === id);
}

export async function deleteQuotation(id: string): Promise<boolean> {
  const records = await readQuotations();
  const next = records.filter((r) => r.id !== id);
  if (next.length === records.length) return false;
  await writeQuotations(next);
  return true;
}

export async function updateQuotationStatus(id: string, status: QuotationStatus): Promise<QuotationRecord | null> {
  const records = await readQuotations();
  const index = records.findIndex((r) => r.id === id);
  if (index === -1) return null;
  const updated: QuotationRecord = { ...records[index], status };
  records[index] = updated;
  await writeQuotations(records);
  return updated;
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
  ownerUsername?: string; // scope to only this user's quotations
  status?: QuotationEffectiveStatus;
  projectId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export async function searchQuotationsFiltered(filters: QuotationFilters): Promise<QuotationRecord[]> {
  const records = await readQuotations();
  let rows = [...records].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  if (filters.ownerUsername) rows = rows.filter((r) => r.created_by === filters.ownerUsername);
  if (filters.projectId) rows = rows.filter((r) => r.project_id === filters.projectId);
  if (filters.status) rows = rows.filter((r) => computeEffectiveStatus(r) === filters.status);
  if (filters.dateFrom) rows = rows.filter((r) => r.created_at.slice(0, 10) >= filters.dateFrom!);
  if (filters.dateTo) rows = rows.filter((r) => r.created_at.slice(0, 10) <= filters.dateTo!);
  if (filters.query && filters.query.trim()) {
    const q = filters.query.trim().toLowerCase();
    rows = rows.filter((r) =>
      [r.quotation_number, r.prepared_by, r.created_by, r.client_name, r.client_company, r.project_vertical]
        .filter(Boolean)
        .some((field) => field.toLowerCase().includes(q))
    );
  }
  return rows;
}

export async function searchQuotations(query?: string): Promise<QuotationRecord[]> {
  return searchQuotationsFiltered({ query });
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
