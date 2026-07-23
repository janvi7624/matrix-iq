import fs from 'fs';
import path from 'path';
import { QuotationRecord } from './types';
import { computeQuotationPrefix, formatQuotationNumber } from './quotationNumber';
import { DomainKey } from './types';

const DATA_FILE = path.join(process.cwd(), 'data', 'quotations.json');

function ensureDataFile(): void {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]\n', 'utf-8');
}

function readQuotations(): QuotationRecord[] {
  ensureDataFile();
  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQuotations(records: QuotationRecord[]): void {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(records, null, 2) + '\n', 'utf-8');
}

export interface CreateQuotationInput {
  prefix?: string;
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

export function createQuotation(input: CreateQuotationInput): QuotationRecord {
  const records = readQuotations();
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
    validity_days: Number(input.validityDays) || 7
  };

  records.push(record);
  writeQuotations(records);
  return record;
}

export function deleteQuotation(id: string): boolean {
  const records = readQuotations();
  const next = records.filter((r) => r.id !== id);
  if (next.length === records.length) return false;
  writeQuotations(next);
  return true;
}

export function searchQuotations(query?: string): QuotationRecord[] {
  const records = readQuotations();
  const sorted = [...records].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  if (!query || !query.trim()) return sorted;

  const q = query.trim().toLowerCase();
  return sorted.filter((r) =>
    [r.quotation_number, r.prepared_by, r.client_name, r.client_company, r.project_vertical]
      .filter(Boolean)
      .some((field) => field.toLowerCase().includes(q))
  );
}

const CSV_COLUMNS: { key: keyof QuotationRecord; header: string }[] = [
  { key: 'quotation_number', header: 'Quotation Number' },
  { key: 'created_at', header: 'Date' },
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
  { key: 'validity_days', header: 'Validity (days)' }
];

function csvEscape(value: unknown): string {
  const str = String(value ?? '');
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export function buildQuotationsCsv(): string {
  const records = searchQuotations();
  const header = CSV_COLUMNS.map((c) => csvEscape(c.header)).join(',');
  const rows = records.map((r) => CSV_COLUMNS.map((c) => csvEscape(r[c.key])).join(','));
  return [header, ...rows].join('\r\n') + '\r\n';
}
