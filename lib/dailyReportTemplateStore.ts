import { Model } from 'sequelize';
import { db, isUuid } from './db';
import { cached, invalidateCache } from './memoCache';
import { listActiveDepartments, listDepartmentManagers } from './departmentStore';
import {
  DailyReportTemplateKey,
  TemplateDefinition,
  TemplateOverrides,
  defaultTemplateForDepartment,
  isTemplateKey,
  resolveTemplate,
  templateIsConfigured,
  BUILT_IN_TEMPLATES,
  TEMPLATE_KEYS
} from './dailyReportTemplates';
import { DailyReportTemplateAssignment } from './dailyReportTypes';

// Department -> which report format, read on every page load and every
// scheduler tick. Same cache-with-explicit-invalidation pattern as the other
// reference-data stores.
const ASSIGNMENTS_CACHE_KEY = 'dailyReportTemplates:all';
const ASSIGNMENTS_CACHE_TTL_MS = 30_000;

function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

export interface TemplateAssignmentRow {
  id: string;
  departmentId: string;
  departmentName: string;
  templateKey: DailyReportTemplateKey;
  status: 'active' | 'not_configured';
  overrides: TemplateOverrides;
  extraManagerIds: string[];
  notes: string;
  updatedAt: string;
  updatedByName: string;
}

function toRow(row: Model, departmentName: string): TemplateAssignmentRow {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const updater = plain.updater as { name?: string; username?: string } | null;
  const key = plain.template_key as string;
  return {
    id: plain.id as string,
    departmentId: plain.department_id as string,
    departmentName,
    // A key written by an older build (or hand-edited) that this build no
    // longer knows falls back to not_configured rather than crashing the
    // page — fail closed, the same direction the rest of the module takes.
    templateKey: isTemplateKey(key) ? key : 'not_configured',
    status: plain.status === 'active' ? 'active' : 'not_configured',
    overrides: (plain.overrides as TemplateOverrides) ?? {},
    extraManagerIds: Array.isArray(plain.extra_manager_ids) ? (plain.extra_manager_ids as string[]).filter(isUuid) : [],
    notes: (plain.notes as string) ?? '',
    updatedAt: isoOrEmpty(plain.updatedAt),
    updatedByName: updater?.name ?? updater?.username ?? ''
  };
}

const updaterInclude = { model: db.User, as: 'updater', attributes: ['id', 'username', 'name'] };

/**
 * Creates the missing rows for any active department that has none yet,
 * seeded from defaultTemplateForDepartment().
 *
 * Additive and never destructive, the same reconcile shape
 * moduleConfigStore.ts and departmentStore.ts already use: a department an
 * admin has already configured is never touched, and a department added to
 * Department Master next month picks up its default on the next read instead
 * of needing a migration. Departments with no obvious format — Accounts,
 * Administration, Back Office — seed as 'not_configured', which excludes
 * their staff from reminders and warnings until someone decides.
 */
async function ensureSeeded(): Promise<void> {
  const departments = await listActiveDepartments();
  if (!departments.length) return;
  const existing = await db.DailyReportTemplate.findAll({ attributes: ['department_id'] });
  const have = new Set(existing.map((r) => r.get('department_id') as string));
  const missing = departments.filter((d) => !have.has(d.id));
  if (missing.length) await createMissing(missing);
  // NOT behind an early return on `missing`. Reconciliation is for rows that
  // ALREADY exist, so the case it has to handle is precisely the one where
  // nothing is missing — an `if (!missing.length) return` above this line
  // means it never runs on an installed system, which is every system that
  // needs it.
  await reconcileNewlyApprovedFormats(departments);
}

async function createMissing(missing: { id: string; name: string }[]): Promise<void> {
  await db.DailyReportTemplate.bulkCreate(
    missing.map((d) => {
      const templateKey = defaultTemplateForDepartment(d.name);
      return {
        department_id: d.id,
        template_key: templateKey,
        // 'active' only when the seed actually recognised the department.
        // Anything that landed on not_configured stays explicitly
        // unconfigured, which is a different (and honest) state from
        // "configured with an empty format".
        status: templateIsConfigured(templateKey) ? 'active' : 'not_configured',
        overrides: {},
        extra_manager_ids: []
      };
    }) as never
  );
}

/**
 * Upgrades a department whose format has since been approved.
 *
 * Accounts and Back Office both seeded as 'not_configured' because no format
 * existed for them yet; both now have one. Seed defaults are never
 * re-applied to a row that already exists (that is what protects an admin's
 * own choice), so without this the two would stay unconfigured forever on
 * any install that had already seeded them — and their staff would keep
 * being excluded from daily reports.
 *
 * Guarded exactly like every reconciliation in lib/moduleConfigStore.ts: it
 * only touches a row still holding BOTH untouched defaults. An admin who has
 * deliberately set a department to not_configured, or picked a different
 * format, keeps their choice.
 */
async function reconcileNewlyApprovedFormats(departments: { id: string; name: string }[]): Promise<void> {
  const rows = await db.DailyReportTemplate.findAll({
    where: { template_key: 'not_configured', status: 'not_configured' } as never
  });
  if (!rows.length) return;
  const nameById = new Map(departments.map((d) => [d.id, d.name]));
  for (const row of rows) {
    const name = nameById.get(row.get('department_id') as string);
    if (!name) continue;
    const templateKey = defaultTemplateForDepartment(name);
    // Only the departments that newly HAVE a format — anything that still
    // maps to not_configured is left exactly as it is.
    if (!templateIsConfigured(templateKey)) continue;
    await row.update({ template_key: templateKey, status: 'active' } as never);
  }
}

export async function listTemplateAssignments(): Promise<TemplateAssignmentRow[]> {
  return cached(ASSIGNMENTS_CACHE_KEY, ASSIGNMENTS_CACHE_TTL_MS, async () => {
    await ensureSeeded();
    const departments = await listActiveDepartments();
    const nameById = new Map(departments.map((d) => [d.id, d.name]));
    const rows = await db.DailyReportTemplate.findAll({ include: [updaterInclude] as never });
    return rows
      // A row whose department was deleted/deactivated is kept in the table
      // (its reports still reference the department) but is not offered for
      // configuration or eligibility.
      .filter((r) => nameById.has(r.get('department_id') as string))
      .map((r) => toRow(r, nameById.get(r.get('department_id') as string) as string))
      .sort((a, b) => a.departmentName.localeCompare(b.departmentName));
  });
}

export async function findAssignmentByDepartmentId(departmentId: string): Promise<TemplateAssignmentRow | undefined> {
  if (!isUuid(departmentId)) return undefined;
  return (await listTemplateAssignments()).find((a) => a.departmentId === departmentId);
}

export async function findAssignmentByDepartmentName(name: string): Promise<TemplateAssignmentRow | undefined> {
  const wanted = (name || '').trim().toLowerCase();
  if (!wanted) return undefined;
  return (await listTemplateAssignments()).find((a) => a.departmentName.trim().toLowerCase() === wanted);
}

export interface ResolvedDepartmentTemplate {
  departmentId: string;
  departmentName: string;
  templateKey: DailyReportTemplateKey;
  configured: boolean;
  template: TemplateDefinition;
  extraManagerIds: string[];
}

/**
 * The template an employee of this department actually files, with the
 * department's admin overrides applied. The one resolution every write path,
 * the renderer and the scheduler share, so the form a person fills in and
 * the schema the server validates against can never be different.
 */
export async function resolveTemplateForDepartment(departmentId: string): Promise<ResolvedDepartmentTemplate> {
  const assignment = await findAssignmentByDepartmentId(departmentId);
  if (!assignment || assignment.status !== 'active') {
    return {
      departmentId,
      departmentName: assignment?.departmentName ?? '',
      templateKey: 'not_configured',
      configured: false,
      template: BUILT_IN_TEMPLATES.not_configured,
      extraManagerIds: assignment?.extraManagerIds ?? []
    };
  }
  const template = resolveTemplate(assignment.templateKey, assignment.overrides);
  return {
    departmentId,
    departmentName: assignment.departmentName,
    templateKey: assignment.templateKey,
    configured: templateIsConfigured(assignment.templateKey),
    template,
    extraManagerIds: assignment.extraManagerIds
  };
}

/**
 * The template a report that was ALREADY FILED should be read with.
 *
 * Keyed off the report's own stored template_key rather than its
 * department's current assignment, so reassigning a department's format does
 * not retroactively turn last month's reports into schema violations or
 * render them with the wrong columns. Overrides still come from the
 * department, since those only ever widen dropdown options.
 */
export async function resolveTemplateForStoredReport(departmentId: string, templateKey: DailyReportTemplateKey): Promise<TemplateDefinition> {
  const assignment = await findAssignmentByDepartmentId(departmentId);
  const overrides = assignment && assignment.templateKey === templateKey ? assignment.overrides : null;
  return resolveTemplate(templateKey, overrides);
}

export class InvalidTemplateAssignmentError extends Error {}

export interface TemplateAssignmentPatch {
  template_key?: DailyReportTemplateKey;
  status?: 'active' | 'not_configured';
  overrides?: TemplateOverrides;
  extra_manager_ids?: string[];
  notes?: string;
}

function sanitizeOverrides(raw: unknown): TemplateOverrides {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const clean: TemplateOverrides = {};

  const options = input.options;
  if (options && typeof options === 'object') {
    const out: Record<string, string[]> = {};
    for (const [field, list] of Object.entries(options as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue;
      const values = list.map((v) => String(v).trim()).filter(Boolean);
      if (values.length) out[field] = Array.from(new Set(values));
    }
    if (Object.keys(out).length) clean.options = out;
  }

  const linked = input.linkedOptions;
  if (linked && typeof linked === 'object') {
    const out: Record<string, Record<string, string[]>> = {};
    for (const [field, catalogue] of Object.entries(linked as Record<string, unknown>)) {
      if (!catalogue || typeof catalogue !== 'object') continue;
      const byCategory: Record<string, string[]> = {};
      for (const [category, list] of Object.entries(catalogue as Record<string, unknown>)) {
        if (!Array.isArray(list)) continue;
        const values = list.map((v) => String(v).trim()).filter(Boolean);
        // A category with no activities would render a dropdown that can
        // never be satisfied, and the validator rejects any pairing it
        // can't find — so drop it here rather than storing a dead end.
        if (values.length) byCategory[String(category).trim()] = Array.from(new Set(values));
      }
      if (Object.keys(byCategory).length) out[field] = byCategory;
    }
    if (Object.keys(out).length) clean.linkedOptions = out;
  }

  // Manager-added sub-category levels. Same shape discipline as
  // linkedOptions above: a category with no values is dropped rather than
  // stored, since it would render a dropdown that can never be satisfied.
  const subCategories = input.subCategories;
  if (subCategories && typeof subCategories === 'object') {
    const out: Record<string, { label: string; catalogue: Record<string, string[]> }> = {};
    for (const [parentKey, raw] of Object.entries(subCategories as Record<string, unknown>)) {
      if (!raw || typeof raw !== 'object') continue;
      const entry = raw as { label?: unknown; catalogue?: unknown };
      const catalogue = entry.catalogue;
      if (!catalogue || typeof catalogue !== 'object') continue;
      const byCategory: Record<string, string[]> = {};
      for (const [category, list] of Object.entries(catalogue as Record<string, unknown>)) {
        if (!Array.isArray(list)) continue;
        const values = list.map((v) => String(v).trim()).filter(Boolean);
        if (values.length) byCategory[String(category).trim()] = Array.from(new Set(values));
      }
      if (!Object.keys(byCategory).length) continue;
      out[String(parentKey).trim()] = {
        label: String(entry.label ?? '').trim().slice(0, 60) || 'Sub-category',
        catalogue: byCategory
      };
    }
    if (Object.keys(out).length) clean.subCategories = out;
  }

  if (input.minEntries !== undefined) {
    const n = Number(input.minEntries);
    if (!Number.isInteger(n) || n < 0 || n > 20) throw new InvalidTemplateAssignmentError('Minimum entries must be between 0 and 20.');
    clean.minEntries = n;
  }
  for (const key of ['measures', 'channels'] as const) {
    const list = input[key];
    if (!Array.isArray(list)) continue;
    const values = list.map((v) => String(v).trim()).filter(Boolean);
    if (values.length) clean[key] = Array.from(new Set(values));
  }
  return clean;
}

export async function updateTemplateAssignment(departmentId: string, patch: TemplateAssignmentPatch, updatedByUserId: string | null): Promise<TemplateAssignmentRow> {
  if (!isUuid(departmentId)) throw new InvalidTemplateAssignmentError('Unknown department.');
  await ensureSeeded();
  const row = await db.DailyReportTemplate.findOne({ where: { department_id: departmentId } as never });
  if (!row) throw new InvalidTemplateAssignmentError('This department has no daily report configuration row.');

  const attrs: Record<string, unknown> = { updated_by: updatedByUserId };
  if (patch.template_key !== undefined) {
    if (!isTemplateKey(patch.template_key)) throw new InvalidTemplateAssignmentError(`"${patch.template_key}" is not a known report format.`);
    attrs.template_key = patch.template_key;
    // Assigning the not-configured placeholder and leaving status 'active'
    // would be a contradiction the rest of the module would have to
    // second-guess, so the two are kept consistent here.
    if (patch.template_key === 'not_configured') attrs.status = 'not_configured';
  }
  if (patch.status !== undefined) {
    if (patch.status !== 'active' && patch.status !== 'not_configured') throw new InvalidTemplateAssignmentError('Status must be "active" or "not_configured".');
    const effectiveKey = (attrs.template_key as string) ?? (row.get('template_key') as string);
    if (patch.status === 'active' && effectiveKey === 'not_configured') {
      throw new InvalidTemplateAssignmentError('Choose a report format before marking this department active.');
    }
    attrs.status = patch.status;
  }
  if (patch.overrides !== undefined) attrs.overrides = sanitizeOverrides(patch.overrides);
  if (patch.extra_manager_ids !== undefined) {
    const ids = Array.from(new Set((patch.extra_manager_ids || []).filter(isUuid)));
    if (ids.length) {
      const found = await db.User.count({ where: { id: ids, status: 'active' } as never });
      if (found !== ids.length) throw new InvalidTemplateAssignmentError('One or more selected managers is not an active user.');
    }
    attrs.extra_manager_ids = ids;
  }
  if (patch.notes !== undefined) attrs.notes = String(patch.notes).slice(0, 2000);

  await row.update(attrs as never);
  invalidateCache(ASSIGNMENTS_CACHE_KEY);
  return (await findAssignmentByDepartmentId(departmentId)) as TemplateAssignmentRow;
}

/** The admin page's view: every department's assignment plus its blast radius. */
export async function listTemplateAssignmentsForAdmin(): Promise<DailyReportTemplateAssignment[]> {
  const [assignments, managersByDepartment] = await Promise.all([listTemplateAssignments(), listDepartmentManagers()]);
  // One grouped count instead of a query per department.
  const counts = await db.User.findAll({
    attributes: ['departmentId', [db.Sequelize.fn('COUNT', db.Sequelize.col('id')), 'count']],
    where: { status: 'active' } as never,
    group: ['departmentId']
  });
  const countByDepartment = new Map(counts.map((r) => [r.get('departmentId') as string, Number(r.get('count'))]));

  return assignments.map((a) => ({
    id: a.id,
    department_id: a.departmentId,
    department_name: a.departmentName,
    template_key: a.templateKey,
    status: a.status,
    overrides: a.overrides,
    extra_manager_ids: a.extraManagerIds,
    notes: a.notes,
    employee_count: countByDepartment.get(a.departmentId) ?? 0,
    manager_names: (managersByDepartment[a.departmentName] || []).map((m) => m.name || m.username),
    updated_at: a.updatedAt,
    updated_by_name: a.updatedByName
  }));
}

/** The catalogue an admin picks from. */
export function listAvailableTemplates() {
  return TEMPLATE_KEYS.map((key) => {
    const t = BUILT_IN_TEMPLATES[key];
    return { key, label: t.label, description: t.description, layout: t.layout };
  });
}

export function invalidateTemplateAssignmentsCache(): void {
  invalidateCache(ASSIGNMENTS_CACHE_KEY);
}
