import { randomBytes } from 'crypto';
import { createUser } from './userStore';
import { listUsers } from './userStore';
import { listDepartments, createDepartment } from './departmentStore';
import { findRoleByKey } from './roleStore';
import { logAudit } from './auditLogStore';
import { PublicUser } from './types';

// Maps a normalized header (lowercased, periods/hyphens stripped) to the
// RawEmployeeRow field it fills — matches the real EmpDetails.xlsx headers
// ("Emp. ID", "Emp. Name", "E-mail", ...) while tolerating minor variations
// in any future re-upload.
const HEADER_MAP: Record<string, keyof Omit<RawEmployeeRow, 'rowNumber'>> = {
  'empid': 'empId',
  'employeeid': 'empId',
  'empname': 'name',
  'employeename': 'name',
  'name': 'name',
  'department': 'department',
  'designation': 'designation',
  'location': 'location',
  'email': 'email',
  'phonenumber': 'phone',
  'phone': 'phone',
  'mobile': 'phone'
};

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z]/g, '');
}

export async function parseEmployeeXlsxBuffer(buffer: ArrayBuffer): Promise<RawEmployeeRow[]> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const columnFieldByIndex = new Map<number, keyof Omit<RawEmployeeRow, 'rowNumber'>>();
  const headerRow = sheet.getRow(1);
  const headerCount = Array.isArray(headerRow.values) ? headerRow.values.length : 0;
  for (let col = 1; col < headerCount; col++) {
    const header = String(headerRow.getCell(col).value ?? '').trim();
    const field = HEADER_MAP[normalizeHeader(header)];
    if (field) columnFieldByIndex.set(col, field);
  }

  const rows: RawEmployeeRow[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const entry: RawEmployeeRow = { rowNumber, empId: '', name: '', department: '', designation: '', location: '', email: '', phone: '' };
    columnFieldByIndex.forEach((field, col) => {
      entry[field] = row.getCell(col).value;
    });
    rows.push(entry);
  });
  return rows;
}

// The exact 7 columns present in public/EmpDetails.xlsx — nothing else is
// assumed. See ExcelJS row.values shape: a hyperlinked cell (several emails
// in the source file are mailto: links) comes through as { text, hyperlink }
// rather than a plain string.
export interface RawEmployeeRow {
  rowNumber: number;
  empId: unknown;
  name: unknown;
  department: unknown;
  designation: unknown;
  location: unknown;
  email: unknown;
  phone: unknown;
}

export type ImportRowStatus = 'created' | 'existing' | 'needsReview' | 'error' | 'skipped';

export interface ImportResultRow {
  rowNumber: number;
  name: string;
  employeeId: string;
  department: string;
  designation: string;
  location: string;
  email: string;
  phone: string;
  status: ImportRowStatus;
  reason: string;
  username: string;
  role: string;
  // Only populated by commit (never by preview), and only ever returned in
  // this one API response — never persisted, never re-fetchable.
  tempPassword?: string;
  matchedExistingUsername?: string;
}

export interface ImportSummary {
  total: number;
  created: number;
  existing: number;
  needsReview: number;
  errors: number;
  skipped: number;
  departmentsCreated: string[];
}

export interface ImportRunResult {
  summary: ImportSummary;
  rows: ImportResultRow[];
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    const obj = value as { text?: unknown; richText?: { text?: string }[] };
    if (typeof obj.text === 'string') return obj.text.trim();
    if (Array.isArray(obj.richText)) return obj.richText.map((r) => r.text || '').join('').trim();
    return '';
  }
  return String(value).trim();
}

// "-" is used as a placeholder Employee ID in the source file for 3 rows;
// "NA" is used as a placeholder email for 1 row — neither is real data.
function normalizeOrEmpty(text: string, placeholders: string[]): string {
  return placeholders.includes(text.toLowerCase()) ? '' : text;
}

export function normalizeEmployeeRow(raw: RawEmployeeRow) {
  return {
    rowNumber: raw.rowNumber,
    name: cellText(raw.name),
    employeeId: normalizeOrEmpty(cellText(raw.empId), ['-', '']),
    department: cellText(raw.department),
    designation: cellText(raw.designation),
    location: cellText(raw.location),
    email: normalizeOrEmpty(cellText(raw.email), ['na', '-', '']).toLowerCase(),
    phone: cellText(raw.phone)
  };
}

function isBlankRow(n: ReturnType<typeof normalizeEmployeeRow>): boolean {
  return !n.name && !n.employeeId && !n.department && !n.designation && !n.location && !n.email && !n.phone;
}

function baseUsername(name: string): string {
  const cleaned = name
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .map((part) => part.replace(/[^a-z0-9]/g, ''))
    .filter(Boolean);
  return cleaned.join('.') || 'employee';
}

const AMBIGUOUS_CHARS = /[0O1lI]/g;
function generateTempPassword(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(10);
  let out = '';
  for (let i = 0; i < 10; i++) out += alphabet[bytes[i] % alphabet.length];
  return out.replace(AMBIGUOUS_CHARS, () => alphabet[randomBytes(1)[0] % alphabet.length]);
}

export interface ProcessImportOptions {
  dryRun: boolean;
  importedBy: string;
  importedByRole: string;
  fileName: string;
}

export async function processEmployeeImport(rawRows: RawEmployeeRow[], opts: ProcessImportOptions): Promise<ImportRunResult> {
  const existingUsers = await listUsers();
  const existingDepartments = await listDepartments();

  const usedUsernames = new Set(existingUsers.map((u) => u.username.toLowerCase()));
  const employeeIdIndex = new Map<string, PublicUser>();
  const emailIndex = new Map<string, PublicUser>();
  existingUsers.forEach((u) => {
    if (u.employeeId) employeeIdIndex.set(u.employeeId.toLowerCase(), u);
    if (u.email) emailIndex.set(u.email.toLowerCase(), u);
  });

  const departmentIndex = new Map<string, string>(); // lowercased name -> id
  existingDepartments.forEach((d) => departmentIndex.set(d.name.toLowerCase(), d.id));
  const departmentsCreated: string[] = [];

  const role = await findRoleByKey('user');
  if (!role) throw new Error('The default "user" role is missing — cannot safely assign a role to imported employees');

  const results: ImportResultRow[] = [];
  // Tracks employeeId/email seen earlier in THIS SAME file, so two rows for
  // the same person within one upload are caught too, not just DB matches.
  const seenInBatchByEmployeeId = new Map<string, number>();
  const seenInBatchByEmail = new Map<string, number>();

  for (const raw of rawRows) {
    const n = normalizeEmployeeRow(raw);

    if (isBlankRow(n)) {
      results.push({ rowNumber: n.rowNumber, name: '', employeeId: '', department: '', designation: '', location: '', email: '', phone: '', status: 'skipped', reason: 'Empty row in source file', username: '', role: '' });
      continue;
    }

    if (!n.name) {
      results.push({ rowNumber: n.rowNumber, name: '', employeeId: n.employeeId, department: n.department, designation: n.designation, location: n.location, email: n.email, phone: n.phone, status: 'error', reason: 'Missing employee name — cannot create an account', username: '', role: '' });
      continue;
    }

    // 1. Duplicate / existing-account detection (employeeId or email match,
    //    against the DB or an earlier row in this same file). Never overwritten.
    const dbMatch =
      (n.employeeId ? employeeIdIndex.get(n.employeeId.toLowerCase()) : undefined) ||
      (n.email ? emailIndex.get(n.email) : undefined);
    const batchMatchRow =
      (n.employeeId ? seenInBatchByEmployeeId.get(n.employeeId.toLowerCase()) : undefined) ||
      (n.email ? seenInBatchByEmail.get(n.email) : undefined);

    if (dbMatch) {
      results.push({
        rowNumber: n.rowNumber, name: n.name, employeeId: n.employeeId, department: n.department, designation: n.designation, location: n.location, email: n.email, phone: n.phone,
        status: 'existing', reason: `Already has an account (matches existing user "${dbMatch.username}") — left untouched`, username: '', role: '', matchedExistingUsername: dbMatch.username
      });
      continue;
    }
    if (batchMatchRow) {
      results.push({
        rowNumber: n.rowNumber, name: n.name, employeeId: n.employeeId, department: n.department, designation: n.designation, location: n.location, email: n.email, phone: n.phone,
        status: 'existing', reason: `Duplicate of row ${batchMatchRow} in this same file — left untouched`, username: '', role: ''
      });
      continue;
    }

    // 2. Username — derived from name, never email (several emails in the
    //    source are shared department mailboxes, e.g. admin@/sales@, which
    //    would otherwise collide with real system usernames).
    const wantedUsername = baseUsername(n.name);
    // A same-name collision with NO Employee ID or email to prove these are
    // two different people is exactly the ambiguous case spec section 11
    // calls out — flag for manual review instead of silently creating a
    // second account for what might be the same person re-imported.
    if (usedUsernames.has(wantedUsername) && !n.employeeId && !n.email) {
      results.push({
        rowNumber: n.rowNumber, name: n.name, employeeId: n.employeeId, department: n.department, designation: n.designation, location: n.location, email: n.email, phone: n.phone,
        status: 'needsReview', reason: `Possible duplicate of an existing account with the same name ("${wantedUsername}") — no Employee ID or email in the source to confirm this is a different person. Not created; review manually.`, username: '', role: ''
      });
      continue;
    }
    let candidate = wantedUsername;
    let suffix = 1;
    while (usedUsernames.has(candidate)) {
      suffix += 1;
      candidate = `${wantedUsername}${suffix}`;
    }
    usedUsernames.add(candidate);

    // 3. Department — Department Master only, case-insensitive lookup, created
    //    once per unique new name (deduped within this batch too). In dryRun
    //    this only records what WOULD be created; in a real run it's inside
    //    the same try/catch as user creation below so a department-creation
    //    failure is reported as an error for this row, not a crashed batch.
    if (opts.dryRun && n.department) {
      const key = n.department.toLowerCase();
      if (!departmentIndex.has(key)) {
        departmentIndex.set(key, '__pending__');
        departmentsCreated.push(n.department);
      }
    }

    // 4. Data-quality flags — imported either way, but surfaced for review.
    const reviewFlags: string[] = [];
    if (!n.employeeId) reviewFlags.push('No Employee ID in source file');
    if (!n.email && !n.phone) reviewFlags.push('No email or phone number in source file');
    if (!n.designation) reviewFlags.push('No designation in source file');
    reviewFlags.push('Assigned default role "User" — review and adjust in Role Management if needed');

    if (n.employeeId) seenInBatchByEmployeeId.set(n.employeeId.toLowerCase(), n.rowNumber);
    if (n.email) seenInBatchByEmail.set(n.email, n.rowNumber);

    const dataFlags = reviewFlags.filter((f) => !f.startsWith('Assigned default role'));
    const status: ImportRowStatus = dataFlags.length ? 'needsReview' : 'created';

    if (opts.dryRun) {
      results.push({
        rowNumber: n.rowNumber, name: n.name, employeeId: n.employeeId, department: n.department, designation: n.designation, location: n.location, email: n.email, phone: n.phone,
        status, reason: reviewFlags.join('; '), username: candidate, role: role.key
      });
      continue;
    }

    try {
      if (n.department) {
        const key = n.department.toLowerCase();
        if (!departmentIndex.has(key)) {
          const createdDept = await createDepartment({ name: n.department }, opts.importedBy);
          departmentIndex.set(key, createdDept.id);
          departmentsCreated.push(n.department);
        }
      }

      const tempPassword = generateTempPassword();
      const created = await createUser({
        username: candidate,
        password: tempPassword,
        name: n.name,
        phone: n.phone,
        email: n.email,
        role: role.key,
        employeeId: n.employeeId,
        department: n.department,
        designation: n.designation,
        location: n.location,
        mustChangePassword: true
      });
      results.push({
        rowNumber: n.rowNumber, name: n.name, employeeId: n.employeeId, department: n.department, designation: n.designation, location: n.location, email: n.email, phone: n.phone,
        status, reason: reviewFlags.join('; '), username: created.username, role: role.key, tempPassword
      });
    } catch (error) {
      results.push({
        rowNumber: n.rowNumber, name: n.name, employeeId: n.employeeId, department: n.department, designation: n.designation, location: n.location, email: n.email, phone: n.phone,
        status: 'error', reason: error instanceof Error ? error.message : 'Could not create this account', username: '', role: ''
      });
    }
  }

  const summary: ImportSummary = {
    total: rawRows.length,
    created: results.filter((r) => r.status === 'created').length,
    existing: results.filter((r) => r.status === 'existing').length,
    needsReview: results.filter((r) => r.status === 'needsReview').length,
    errors: results.filter((r) => r.status === 'error').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    departmentsCreated
  };

  if (!opts.dryRun) {
    await logAudit({
      by: opts.importedBy,
      role: opts.importedByRole,
      entityType: 'user_import',
      entityId: '',
      action: 'bulk_import',
      previousStatus: '',
      newStatus: '',
      remarks: JSON.stringify({
        fileName: opts.fileName,
        total: summary.total,
        created: summary.created,
        existing: summary.existing,
        needsReview: summary.needsReview,
        errors: summary.errors,
        skipped: summary.skipped,
        departmentsCreated: summary.departmentsCreated
      })
    });
  }

  return { summary, rows: results };
}
