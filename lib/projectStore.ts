import { Model, Op, QueryTypes, Transaction } from 'sequelize';
import { ProjectNote, ProjectRecord, ProjectStage, ProjectStatus, ProjectTimelineEvent } from './types';
import { clearOverrideOnStageChange, clampPercent, resolveClosingPercent } from './salesStageRules';
import { db, isUuid, sequelize } from './db';
import { resolveVisibilityScope } from './departmentScope';
import { isUserADepartmentManager, departmentsManagedBy } from './departmentStore';
import { projectLabel } from './projectLabel';

const FIELDS = [
  { name: 'client_name' },
  { name: 'company' },
  { name: 'contact_person' },
  { name: 'alt_contact_phone' },
  { name: 'phone' },
  { name: 'email' },
  { name: 'address' },
  { name: 'sales_person' },
  { name: 'source' },
  { name: 'status' },
  { name: 'stage' },
  { name: 'closed_at', kind: 'nullable' as const },
  { name: 'cold_call_responded' },
  { name: 'priority' },
  { name: 'expected_closing_date', kind: 'nullable' as const },
  { name: 'next_follow_up_date', kind: 'nullable' as const },
  { name: 'remarks' },
  // readOnly: mapped on the way OUT but never accepted from a patch.
  // Closing % is derived from the stage, so letting a request set it would
  // reopen the exact hole this change closes — and the dashboard is not the
  // only way in: a crafted PATCH straight at /api/projects/[id] used to be
  // enough. An admin changes it through the dedicated override route, which
  // demands a reason and writes an audit row.
  { name: 'closing_probability_percent', kind: 'nullable' as const, readOnly: true },
  { name: 'legacy_closing_percent', kind: 'nullable' as const, readOnly: true },
  { name: 'closing_percent_override', kind: 'nullable' as const, readOnly: true },
  { name: 'closing_percent_override_reason', readOnly: true },
  { name: 'closing_percent_override_by', kind: 'nullable' as const, readOnly: true },
  { name: 'closing_percent_override_at', kind: 'nullable' as const, readOnly: true },
  { name: 'expected_po_date', kind: 'nullable' as const },
  { name: 'confirmed_by_contact' },
  { name: 'lost_reason' },
  { name: 'quote_value', kind: 'decimal' as const },
  { name: 'quotation_date', kind: 'nullable' as const },
  // Maintained by the store on every stage change, never by a caller —
  // otherwise a client could reset a deal's age and make a stale pipeline
  // look fresh, which is one of the two things this dashboard is for.
  { name: 'stage_entered_at', kind: 'nullable' as const, readOnly: true },
  { name: 'approx_price', kind: 'decimal' as const },
  { name: 'attachments', kind: 'json' as const },
  { name: 'skipped_stages', kind: 'json' as const },
  { name: 'departments', kind: 'json' as const },
  { name: 'department_amounts', kind: 'json' as const },
  { name: 'assigned_technical_person_id', kind: 'nullable' as const },
  { name: 'project_lead_id', kind: 'nullable' as const },
  { name: 'opportunity_type', kind: 'nullable' as const },
  { name: 'project_name' },
  { name: 'project_brief' },
  { name: 'state' },
  { name: 'city' },
  { name: 'referral_name' },
  { name: 'tender_capex', kind: 'nullable' as const },
  { name: 'tender_opex', kind: 'nullable' as const },
  { name: 'tender_ref_number' },
  { name: 'tender_name' },
  { name: 'tender_deadline', kind: 'nullable' as const },
  { name: 'tender_estimated_value', kind: 'nullable' as const },
  { name: 'tender_pbg' },
  { name: 'tender_emd', kind: 'nullable' as const },
  { name: 'payment_terms' },
  { name: 'tms_project_id', kind: 'nullable' as const },
  { name: 'lead_confirmation_status', kind: 'nullable' as const },
  { name: 'confirmed_by', kind: 'nullable' as const },
  { name: 'confirmed_at', kind: 'nullable' as const },
  // Partner Portal overlay. ALL readOnly: these are mapped on the way OUT
  // (so the Projects list and detail view can show the partner badge and the
  // review state) but never accepted from a patch — same rule, and the same
  // reasoning, as the closing-percentage fields above. A crafted
  // PATCH /api/projects/[id] must not be able to attach a project to a
  // partner, mark its own submission approved, or forge a reviewer. Those
  // moves go through the dedicated functions at the bottom of this file,
  // which check authorization and write a timeline event.
  { name: 'partner_id', kind: 'nullable' as const, readOnly: true },
  { name: 'partner_submission_status', kind: 'nullable' as const, readOnly: true },
  { name: 'partner_reviewed_by', kind: 'nullable' as const, readOnly: true },
  { name: 'partner_reviewed_at', kind: 'nullable' as const, readOnly: true },
  { name: 'partner_review_remarks', readOnly: true },
  { name: 'partner_submitted_value', kind: 'decimal' as const, readOnly: true },
  { name: 'partner_expected_timeline', readOnly: true }
];

// Lead -> Project automation's completeness check lives in
// lib/projectCompleteness.ts (a pure, dependency-free file) so client
// components can import it too, without pulling this Sequelize-dependent
// module into the browser bundle. Re-exported here for server-side callers
// that already import everything else project-related from this file.
export { checkProjectCompleteness } from './projectCompleteness';
export type { ProjectCompleteness } from './projectCompleteness';

function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

function toAttr(value: unknown, kind: string): unknown {
  if (kind === 'nullable' || kind === 'decimal') return value === '' || value === undefined || value === null ? null : value;
  return value;
}

function noteToRow(note: ProjectNote, projectId: string) {
  return { project_id: projectId, at: note.at ? new Date(note.at) : new Date(), by: note.by, text: note.text };
}

// Note: takes an already-plain object, not a Model — these come from a
// parent row's `.get({ plain: true })`, which recursively flattens included
// associations into plain objects too (they're never Model instances here).
function rowToNote(plain: Record<string, unknown>): ProjectNote {
  return { id: plain.id as string, at: isoOrEmpty(plain.at), by: (plain.by as string) ?? '', text: (plain.text as string) ?? '' };
}

function timelineToRow(event: ProjectTimelineEvent, projectId: string) {
  return { project_id: projectId, at: event.at ? new Date(event.at) : new Date(), by: event.by, stage: event.stage, label: event.label, remarks: event.remarks };
}

function rowToTimelineEvent(plain: Record<string, unknown>): ProjectTimelineEvent {
  return {
    id: plain.id as string,
    at: isoOrEmpty(plain.at),
    by: (plain.by as string) ?? '',
    stage: plain.stage as ProjectTimelineEvent['stage'],
    label: (plain.label as string) ?? '',
    remarks: (plain.remarks as string) ?? ''
  };
}

const creatorInclude = { model: db.User, as: 'creator', attributes: ['id', 'username'] };
const assignedTechnicalPersonInclude = { model: db.User, as: 'assignedTechnicalPersonRef', attributes: ['id', 'name'] };
const projectLeadInclude = { model: db.User, as: 'projectLeadRef', attributes: ['id', 'name'] };
const notesInclude = { model: db.ProjectNote, as: 'notes' };
const timelineInclude = { model: db.ProjectTimelineEvent, as: 'timeline' };
// attributes narrowed to the two fields the badge needs — this join now runs
// on every Projects list read, and the partner row carries address, notes and
// contact details that no list view wants.
const partnerInclude = { model: db.Partner, as: 'partner', attributes: ['id', 'company_name', 'partner_code'], required: false };
const allIncludes = [creatorInclude, assignedTechnicalPersonInclude, projectLeadInclude, notesInclude, timelineInclude, partnerInclude];
// List views (Dashboard, Projects table, KPIs, search) only ever read the
// plain project fields — never .notes/.timeline, which for a project with a
// long history can be the bulk of the row's join cost. toRecord() already
// defaults both to [] when the include isn't present, so this is a drop-in
// lighter read for anything that isn't rendering a single project's full
// history (see findProjectById / performance-review, which still need them).
const lightIncludes = [creatorInclude, assignedTechnicalPersonInclude, projectLeadInclude, partnerInclude];

function toRecord(row: Model): ProjectRecord {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const record: Record<string, unknown> = {
    id: plain.id,
    created_at: isoOrEmpty(plain.createdAt),
    created_by: (plain.creator as { username?: string } | null)?.username ?? '',
    updated_at: isoOrEmpty(plain.updatedAt),
    assigned_technical_person_name: (plain.assignedTechnicalPersonRef as { name?: string } | null)?.name ?? '',
    // Real value populated only by findProjectById below (a second, cheap
    // query on a single project) — every bulk list read (readAll/list/
    // listLight) leaves this empty, same convention as notes/timeline above.
    assigned_technical_people: [],
    project_lead_name: (plain.projectLeadRef as { name?: string } | null)?.name ?? '',
    // Resolved display fields for the partner badge on the internal Projects
    // list / detail view. Empty on every direct (non-partner) project.
    partner_name: (plain.partner as { company_name?: string } | null)?.company_name ?? '',
    partner_code: (plain.partner as { partner_code?: string } | null)?.partner_code ?? '',
    notes: ((plain.notes as Record<string, unknown>[]) ?? []).map(rowToNote).sort((a, b) => (a.at < b.at ? -1 : 1)),
    timeline: ((plain.timeline as Record<string, unknown>[]) ?? []).map(rowToTimelineEvent).sort((a, b) => (a.at < b.at ? -1 : 1)),
    // Populated only by the Dashboard read path (see listLastRemarks below,
    // merged in by the GET /api/projects route) — every other caller of
    // toRecord() gets these empty, same as any other resolved display field.
    last_remark: '',
    last_remark_at: '',
    last_remark_by: ''
  };
  for (const { name, kind = 'string' } of FIELDS) {
    const raw = plain[name];
    if (kind === 'nullable') record[name] = raw ?? '';
    else if (kind === 'json') record[name] = raw ?? [];
    // node-postgres returns DECIMAL as a STRING (to preserve precision), so
    // without this coercion `approx_price` would reach the UI as
    // "1250000.00" — where toLocaleString('en-IN') is a no-op (String's own
    // method, not Number's), rendering "₹1250000.00" instead of "₹12,50,000",
    // and every `typeof x === 'number'` total silently summed it as 0.
    else if (kind === 'decimal') record[name] = raw === null || raw === undefined ? '' : Number(raw);
    else record[name] = raw ?? '';
  }
  return record as unknown as ProjectRecord;
}

async function readAll(): Promise<ProjectRecord[]> {
  const rows = await db.Project.findAll({ include: allIncludes, order: [['created_at', 'DESC']] });
  return rows.map(toRecord);
}

async function readAllLight(): Promise<ProjectRecord[]> {
  const rows = await db.Project.findAll({ include: lightIncludes, order: [['created_at', 'DESC']] });
  return rows.map(toRecord);
}

// Visibility (not capability — remove()/delete rights below still key off
// viewerIsPrivileged as before) is resolved from the viewer's department
// scope, not the raw isPrivileged flag: an org-wide viewer gets {} (no
// filter), everyone else sees projects they created OR are the assigned
// technical person on, widened to their whole managed department's team
// when they manage one. See lib/departmentScope.ts.
//
// Engineers used to be the one exception (assigned-only), back when they
// couldn't create Sales projects. They can now (for a sales person, or via a
// lead's "To Project"), so they follow the same rule as everyone else —
// otherwise a project they own would vanish from their own list, while
// canAccessProject below still let them open it by id.
//
// A project's Lead / Mentor (project_lead_id) sees it too — being named the
// lead is what puts a project in their own Project Dashboard, on top of the
// ones they own. Same shape as the assigned technical person branch above.
async function resolveOwnerWhere(viewerUsername: string): Promise<Record<string, unknown>> {
  const scope = await resolveVisibilityScope(viewerUsername);
  if (!scope.scopedUserIds) return {};
  // assigned_technical_person_id only ever covers the PRIMARY (first-assigned)
  // technical person — a project's other, equally-real assignees live in
  // project_technical_assignments instead (lib/projectTechnicalRequest.ts),
  // so without this branch a second assigned person's own project vanished
  // from their own Projects list/dashboard despite genuinely being on it.
  const teamAssignments = await db.ProjectTechnicalAssignment.findAll({
    where: { user_id: { [Op.in]: scope.scopedUserIds } } as never,
    attributes: ['project_id']
  });
  const teamProjectIds = teamAssignments.map((r) => r.get('project_id') as string);
  return {
    [Op.or]: [
      { created_by: { [Op.in]: scope.scopedUserIds } },
      { assigned_technical_person_id: { [Op.in]: scope.scopedUserIds } },
      { project_lead_id: { [Op.in]: scope.scopedUserIds } },
      ...(teamProjectIds.length ? [{ id: { [Op.in]: teamProjectIds } }] : [])
    ]
  };
}

async function list(viewerUsername: string): Promise<ProjectRecord[]> {
  const where = await resolveOwnerWhere(viewerUsername);
  const rows = await db.Project.findAll({ where: where as never, include: allIncludes, order: [['created_at', 'DESC']] });
  return rows.map(toRecord);
}

async function listLight(viewerUsername: string): Promise<ProjectRecord[]> {
  const where = await resolveOwnerWhere(viewerUsername);
  const rows = await db.Project.findAll({ where: where as never, include: lightIncludes, order: [['created_at', 'DESC']] });
  return rows.map(toRecord);
}

// Strictly "projects this one user personally created" — used by admin
// per-employee reports (Activity, Performance Review), which must not
// silently widen to a target's whole managed team just because they happen
// to be a department manager (unlike list()/listLight() above, which
// resolve the VIEWER's own visibility scope for dashboards/list pages).
async function listOwnedBy(username: string): Promise<ProjectRecord[]> {
  const user = await db.User.findOne({ where: { username } as never, attributes: ['id'] });
  const where = { created_by: user ? user.get('id') : '00000000-0000-0000-0000-000000000000' };
  const rows = await db.Project.findAll({ where: where as never, include: lightIncludes, order: [['created_at', 'DESC']] });
  return rows.map(toRecord);
}

async function create(record: ProjectRecord): Promise<ProjectRecord> {
  const attrs: Record<string, unknown> = {};
  // Same read-only rule as update(): a new project gets the Closing % its
  // starting stage implies, and no caller may post one in.
  for (const { name, kind = 'string', readOnly } of FIELDS) {
    if (readOnly) continue;
    attrs[name] = toAttr((record as unknown as Record<string, unknown>)[name], kind);
  }
  // created_by is "the sales person" (see comment below), which is usually
  // but not guaranteed to be a real logged-in account — falls back to NULL
  // (viewer-privileged-only visibility) rather than failing the write.
  const creator = await db.User.findOne({ where: { username: record.created_by } as never });

  return sequelize.transaction(async (t) => {
    const row = await db.Project.create({ ...attrs, created_by: creator ? creator.get('id') : null } as never, { transaction: t });
    if (record.notes?.length) await db.ProjectNote.bulkCreate(record.notes.map((n) => noteToRow(n, row.get('id') as string)) as never, { transaction: t });
    if (record.timeline?.length) await db.ProjectTimelineEvent.bulkCreate(record.timeline.map((e) => timelineToRow(e, row.get('id') as string)) as never, { transaction: t });
    const withAssoc = await db.Project.findByPk(row.get('id') as string, { include: allIncludes, transaction: t });
    return toRecord(withAssoc as Model);
  });
}

async function update(id: string, patch: Partial<ProjectRecord>): Promise<ProjectRecord | null> {
  if (!isUuid(id)) return null;
  const row = await db.Project.findByPk(id);
  if (!row) return null;

  return sequelize.transaction(async (t) => {
    const attrs: Record<string, unknown> = {};
    const patchObj = patch as unknown as Record<string, unknown>;
    for (const { name, kind = 'string', readOnly } of FIELDS) {
      // A read-only field is silently ignored rather than rejected: this
      // loop runs for every PATCH, and a client echoing back the record it
      // just read (which the detail view does) would otherwise fail every
      // save. The percentage fields it drops are derived or override-only,
      // so dropping them loses nothing a caller is entitled to set.
      if (readOnly) continue;
      if (name in patchObj) attrs[name] = toAttr(patchObj[name], kind);
    }
    // closed_at (see ProjectRecord's comment) — derived here, never accepted
    // directly from a patch, so every caller that flips status gets it for
    // free. Won/Lost stamps "now"; moving back to active/on_hold (a reopen)
    // clears it so the project doesn't stay eligible for the Projects list's
    // 90-day auto-hide.
    if (typeof patch.status === 'string' && patch.status !== (row.get('status') as string)) {
      attrs.closed_at = patch.status === 'won' || patch.status === 'lost' ? new Date() : null;
    }
    // An admin override does not survive a stage change. It is a judgement
    // about a deal AT a point in the pipeline ("this Negotiation is better
    // than 70%"), so carrying it into the next stage would assert a
    // judgement nobody made — and would be invisible, since the number
    // looks the same either way. Cleared here rather than taken from the
    // patch, exactly like closed_at above, so every caller that moves a
    // stage gets it for free.
    if (typeof patch.stage === 'string'
        && clearOverrideOnStageChange(row.get('stage') as ProjectStage, patch.stage as ProjectStage)) {
      attrs.closing_percent_override = null;
      attrs.closing_percent_override_reason = '';
      attrs.closing_percent_override_by = null;
      attrs.closing_percent_override_at = null;
      // Same trigger, same reason it is derived here: every path that
      // moves a stage must restart the clock, and no path may set it.
      attrs.stage_entered_at = new Date();
    }
    // created_by is deliberately NOT in FIELDS (it's the real ownership/
    // visibility key, resolved from a username same as create() above) —
    // reassigning ownership (e.g. Lead reassignment updating its linked
    // project, see lib/leadProjectAutomation.ts) is the one legitimate
    // reason to change it after creation.
    if (typeof patch.created_by === 'string' && patch.created_by) {
      const newOwner = await db.User.findOne({ where: { username: patch.created_by } as never, transaction: t });
      if (newOwner) attrs.created_by = newOwner.get('id');
    }
    await row.update(attrs as never, { transaction: t });

    if (patch.notes) {
      await db.ProjectNote.destroy({ where: { project_id: id } as never, transaction: t });
      if (patch.notes.length) await db.ProjectNote.bulkCreate(patch.notes.map((n) => noteToRow(n, id)) as never, { transaction: t });
    }
    if (patch.timeline) {
      await db.ProjectTimelineEvent.destroy({ where: { project_id: id } as never, transaction: t });
      if (patch.timeline.length) await db.ProjectTimelineEvent.bulkCreate(patch.timeline.map((e) => timelineToRow(e, id)) as never, { transaction: t });
    }

    const withAssoc = await db.Project.findByPk(id, { include: allIncludes, transaction: t });
    return toRecord(withAssoc as Model);
  });
}

// A project with any dependent record (site visit, quotation, demo,
// negotiation, PO, customer response, installation, DC) can't be deleted —
// deleting the project only soft-deletes it (paranoid: true), so nothing is
// physically lost, but every child record's project_id would silently point
// at a project that findProjectById can no longer resolve, with no way back
// to it from those lists. Same "in use -> block, not silently orphan"
// pattern as lib/departmentStore.ts's deleteDepartment.
async function isProjectInUse(id: string): Promise<boolean> {
  const [siteVisits, quotations, demos, negotiations, pos, responses, installations, dcs] = await Promise.all([
    db.SiteVisit.count({ where: { project_id: id } as never }),
    db.Quotation.count({ where: { project_id: id } as never }),
    db.DemoSchedule.count({ where: { project_id: id } as never }),
    db.Negotiation.count({ where: { project_id: id } as never }),
    db.PurchaseOrder.count({ where: { project_id: id } as never }),
    db.CustomerResponse.count({ where: { project_id: id } as never }),
    db.Installation.count({ where: { project_id: id } as never }),
    db.DeliveryChallan.count({ where: { project_id: id } as never })
  ]);
  return siteVisits + quotations + demos + negotiations + pos + responses + installations + dcs > 0;
}

async function remove(id: string, viewerUsername: string, viewerIsPrivileged: boolean): Promise<{ ok: boolean; reason?: string }> {
  if (!viewerIsPrivileged) return { ok: false, reason: 'Project not found' };
  if (!isUuid(id)) return { ok: false, reason: 'Project not found' };
  const row = await db.Project.findByPk(id);
  if (!row) return { ok: false, reason: 'Project not found' };
  if (await isProjectInUse(id)) {
    return { ok: false, reason: 'This project has linked records (site visits, quotations, demos, etc.) and cannot be deleted — its status/stage can still be changed to reflect it is closed/lost.' };
  }
  await row.destroy();
  return { ok: true };
}

// Records written before `notes`/`attachments` existed on ProjectRecord won't
// have them in blob storage — every reader of a single project must go
// through this so the View page (and anything else touching `.notes`/
// `.attachments`) never crashes on `undefined.length`.
/**
 * The shape every read path hands out — and the one place Closing % is
 * decided.
 *
 * Deriving it HERE rather than storing it is what makes the dashboard, the
 * project detail view, the PDF export and the CSV/Excel exports agree by
 * construction: they all come through this function, so there is no second
 * copy to fall out of step. A stored percentage that disagreed with its own
 * stage is precisely the defect being fixed, and the surest way not to
 * reintroduce it is to leave nothing to go stale.
 *
 * The stored closing_probability_percent column is deliberately overwritten
 * in the returned record and never read: it still holds the pre-change
 * hand-typed figure for rows nobody has touched, which is exactly the number
 * that must not be trusted. Its history lives in legacy_closing_percent.
 */
export interface ClosingPercentOverrideInput {
  percent: number;
  reason: string;
  actorUserId: string | null;
}

/**
 * Writes an admin's manual Closing %, with the reason that justifies it.
 *
 * Separate from update() on purpose: the override columns are marked
 * readOnly in FIELDS, so the ordinary project PATCH cannot reach them no
 * matter how the request is crafted. This is the only door, and the route
 * that calls it is the only place the admin check lives.
 *
 * Returns the previous value alongside the updated record, because the
 * audit row has to state what the figure was before — which is the part
 * that makes an override reviewable rather than merely recorded.
 */
export async function setClosingPercentOverride(
  id: string,
  input: ClosingPercentOverrideInput
): Promise<{ project: ProjectRecord; previousPercent: number | ''; previousReason: string } | null> {
  if (!isUuid(id)) return null;
  const row = await db.Project.findByPk(id);
  if (!row) return null;

  const previousRaw = row.get('closing_percent_override');
  const previousPercent = previousRaw === null || previousRaw === undefined ? '' : Number(previousRaw);
  const previousReason = String(row.get('closing_percent_override_reason') ?? '');

  await row.update({
    closing_percent_override: clampPercent(input.percent),
    closing_percent_override_reason: input.reason.trim(),
    closing_percent_override_by: input.actorUserId,
    closing_percent_override_at: new Date()
  } as never);

  const withAssoc = await db.Project.findByPk(id, { include: allIncludes });
  return {
    project: normalizeProject(toRecord(withAssoc as Model)),
    previousPercent,
    previousReason
  };
}

/**
 * Removes an override, restoring the stage's standard figure.
 *
 * Returns null when the project does not exist, and the previous value
 * otherwise — including when there was nothing to clear, so the caller can
 * tell "cleared" from "there was no override" and avoid writing a
 * meaningless audit row.
 */
export async function clearClosingPercentOverride(
  id: string
): Promise<{ project: ProjectRecord; previousPercent: number | '' } | null> {
  if (!isUuid(id)) return null;
  const row = await db.Project.findByPk(id);
  if (!row) return null;

  const previousRaw = row.get('closing_percent_override');
  const previousPercent = previousRaw === null || previousRaw === undefined ? '' : Number(previousRaw);

  await row.update({
    closing_percent_override: null,
    closing_percent_override_reason: '',
    closing_percent_override_by: null,
    closing_percent_override_at: null
  } as never);

  const withAssoc = await db.Project.findByPk(id, { include: allIncludes });
  return { project: normalizeProject(toRecord(withAssoc as Model)), previousPercent };
}

function normalizeProject(project: ProjectRecord): ProjectRecord {
  const { percent, source } = resolveClosingPercent({
    stage: project.stage,
    status: project.status,
    closing_percent_override: project.closing_percent_override === '' ? null : project.closing_percent_override
  });

  return {
    ...project,
    // Empty string rather than 0 when unknown — a retired stage awaiting
    // re-triage has no answer, and 0 would quietly understate the forecast
    // by the full value of the deal while looking like a real figure.
    closing_probability_percent: percent === null ? '' : percent,
    closing_percent_source: source,
    notes: project.notes ?? [],
    attachments: project.attachments ?? [],
    skipped_stages: project.skipped_stages ?? [],
    departments: project.departments ?? [],
    department_amounts: project.department_amounts ?? {},
    timeline: project.timeline ?? [],
    source: project.source ?? ''
  };
}

// The most recent Activity Log entry that actually HAS a remark, per
// project — backs the Project Dashboard's "Last Remark" column. One
// DISTINCT ON query for the whole dashboard rather than joining the full
// (potentially long) timeline onto every row in listLight(), which the
// comment above readAllLight() already flags as deliberately excluded there
// for performance.
export async function listLastRemarks(projectIds: string[]): Promise<Record<string, { remark: string; at: string; by: string }>> {
  const ids = projectIds.filter(isUuid);
  if (!ids.length) return {};

  const rows = (await sequelize.query(
    `SELECT DISTINCT ON (project_id) project_id, remarks, at, "by"
     FROM project_timeline_events
     WHERE project_id IN (:ids) AND remarks IS NOT NULL AND remarks <> ''
     ORDER BY project_id, at DESC`,
    { replacements: { ids }, type: QueryTypes.SELECT }
  )) as { project_id: string; remarks: string; at: Date; by: string }[];

  const result: Record<string, { remark: string; at: string; by: string }> = {};
  for (const row of rows) {
    result[row.project_id] = { remark: row.remarks, at: isoOrEmpty(row.at), by: row.by ?? '' };
  }
  return result;
}

// Single-project access — mirrors projectStore's own list-visibility rule
// (created it, assigned to it, or it belongs to a department this viewer
// manages) rather than the old creator-or-privileged-only check, so a
// department manager can open a team member's project directly by id, but
// nobody can reach another department's project just by knowing its id.
// Moved here (from app/api/projects/[id]/route.ts) so the new deadline-
// extension routes can reuse it too instead of re-implementing it.
export async function canAccessProject(viewerUsername: string, project: { id: string; created_by: string; assigned_technical_person_id: string; project_lead_id?: string }): Promise<boolean> {
  const scope = await resolveVisibilityScope(viewerUsername);
  if (scope.seesOrgWide) return true;
  const ids = scope.scopedUserIds ?? [];
  if (project.assigned_technical_person_id && ids.includes(project.assigned_technical_person_id)) return true;
  if (project.project_lead_id && ids.includes(project.project_lead_id)) return true;
  // Primary-only above would otherwise lock out a project's OTHER equally
  // real technical assignees (project_technical_assignments) — a second
  // person approved for a project must be able to open it too, not just
  // whoever happened to be assigned first.
  if (project.id && ids.length && (await db.ProjectTechnicalAssignment.findOne({ where: { project_id: project.id, user_id: { [Op.in]: ids } } as never }))) {
    return true;
  }
  if (project.created_by) {
    const creator = await db.User.findOne({ where: { username: project.created_by } as never, attributes: ['id'] });
    if (creator && ids.includes(creator.get('id') as string)) return true;
  }
  // A TMS manager (technical-manager/team-lead) already sees the TMS project
  // this Sales project was handed off to — tmsProjectStore.listForViewer
  // scopes that to their own department plus any they manage
  // (tmsTeamDepartmentIds in lib/tmsAccess.ts). resolveVisibilityScope above
  // has no idea that concept exists (it only expands scope via
  // Department.managerIds, the separate org-wide "manager" concept), so
  // without this a manager who opens "View Sales Project" from a project
  // they manage in TMS got a 403 for a project they could already see the
  // TMS side of. Mirrors tmsTeamDepartmentIds exactly, just keyed off the
  // assigned technical person's department instead of a TmsViewer.
  if (project.assigned_technical_person_id && await canViewAsTmsManagerOfAssignee(viewerUsername, project.assigned_technical_person_id)) {
    return true;
  }
  return false;
}

async function canViewAsTmsManagerOfAssignee(viewerUsername: string, assignedPersonId: string): Promise<boolean> {
  const viewer = await db.User.findOne({
    where: { username: viewerUsername } as never,
    include: [{ model: db.Role, as: 'role', attributes: ['key'] }],
    attributes: ['departmentId']
  });
  const roleKey = (viewer?.get('role') as { key?: string } | null)?.key ?? '';
  if (roleKey !== 'technical-manager' && roleKey !== 'team-lead') return false;

  const assignedPerson = await db.User.findOne({ where: { id: assignedPersonId } as never, attributes: ['departmentId'] });
  const assignedDeptId = assignedPerson?.get('departmentId') as string | undefined;
  if (!assignedDeptId) return false;

  const viewerDeptId = viewer?.get('departmentId') as string | undefined;
  if (viewerDeptId === assignedDeptId) return true;
  const managed = await departmentsManagedBy(viewerUsername);
  return managed.some((d) => d.id === assignedDeptId);
}

// The 3-tier approval chain a Sales Project deadline-extension REQUEST
// climbs — mirrors lib/tmsAccess.ts's resolveTmsDeadlineTier exactly, just
// with Sales' own manager concept: the generic 'manager' role, OR a real
// department manager (isUserADepartmentManager — same helper Team Tasks
// already uses), since "manager" here isn't one fixed role the way TMS's
// technical-manager/team-lead pair is. NOTE: viewer.isPrivileged is true for
// role 'manager' too (see PRIVILEGED_ROLES), so admin-tier must be checked
// by exact role name first, not by isPrivileged alone.
export async function resolveProjectDeadlineTier(viewer: { username: string; role: string; isPrivileged: boolean }): Promise<'plain' | 'manager' | 'admin'> {
  if (viewer.role === 'superadmin' || viewer.role === 'admin') return 'admin';
  if (viewer.role === 'manager') return 'manager';
  if (await isUserADepartmentManager(viewer.username)) return 'manager';
  return 'plain';
}

// list/listLight keep accepting viewerIsPrivileged for call-site
// compatibility (every route still has it handy from getViewerContext) but
// no longer use it directly — visibility is resolved from the viewer's
// department scope instead (see resolveOwnerWhere/resolveVisibilityScope).
// remove() below still keys deletion rights off viewerIsPrivileged, which is
// a capability check, not a visibility one, and stays exactly as it was.
export const projectStore = {
  list: async (viewerUsername: string, _viewerIsPrivileged: boolean) => (await list(viewerUsername)).map(normalizeProject),
  listLight: async (viewerUsername: string, _viewerIsPrivileged: boolean) => (await listLight(viewerUsername)).map(normalizeProject),
  listOwnedBy: async (username: string) => (await listOwnedBy(username)).map(normalizeProject),
  // Unscoped — every project, no visibility filtering. For aggregate/admin
  // computations only (e.g. department health scoring), never for a
  // viewer-facing list; callers must apply their own authorization first.
  readAll: async () => (await readAll()).map(normalizeProject),
  // Same as readAll() but without the notes/timeline joins — for aggregate
  // computations (department health scoring) that only ever read plain
  // fields, same rationale as listLight() above.
  readAllLight: async () => (await readAllLight()).map(normalizeProject),
  create,
  update,
  remove
};

// Direct write of the sales-owner fields (created_by/sales_person) — the
// same fields the project-handover-approval flow already writes directly
// for the same reason: `update()`'s FIELDS whitelist deliberately excludes
// `created_by` (capture history, not a reassignable "current owner"). Used
// by the Employee Exit bulk-reassignment flow, which passes its own
// transaction so this participates in the same atomic commit as every other
// entity being reassigned.
export async function reassignProjectOwner(id: string, newOwnerId: string, options?: { transaction?: Transaction }): Promise<void> {
  if (!isUuid(id) || !isUuid(newOwnerId)) return;
  const newOwner = await db.User.findByPk(newOwnerId, { attributes: ['id', 'username'], transaction: options?.transaction });
  if (!newOwner) return;
  await db.Project.update(
    { created_by: newOwnerId, sales_person: newOwner.get('username') as string },
    { where: { id } as never, transaction: options?.transaction }
  );
}

export async function findProjectById(id: string): Promise<ProjectRecord | undefined> {
  if (!isUuid(id)) return undefined;
  const row = await db.Project.findByPk(id, { include: allIncludes });
  if (!row) return undefined;
  const record = normalizeProject(toRecord(row));
  record.assigned_technical_people = await listAssignedTechnicalPeople(id);
  return record;
}

// Every CURRENTLY assigned technical person on a project, all equal — the
// real multi-person list behind assigned_technical_people (see its comment
// on ProjectRecord in lib/types.ts). A separate, cheap query rather than an
// eager include on every project read: only the detail page
// (findProjectById) ever needs the full team, and adding this join to
// listLight()/list() — read on every dashboard/KPI load — would reintroduce
// exactly the kind of extra per-row cost the Dashboard Health cache was just
// added to avoid.
export async function listAssignedTechnicalPeople(projectId: string): Promise<{ id: string; username: string; name: string }[]> {
  if (!isUuid(projectId)) return [];
  const rows = await db.ProjectTechnicalAssignment.findAll({
    where: { project_id: projectId } as never,
    include: [{ model: db.User, as: 'person', attributes: ['id', 'username', 'name'] }],
    order: [['created_at', 'ASC']]
  });
  return rows
    .map((r) => (r.get({ plain: true }) as { person?: { id: string; username: string; name: string } }).person)
    .filter((p): p is { id: string; username: string; name: string } => !!p);
}

// Active Sales Projects this person is a formally assigned technical person
// on — PRIMARY (assigned_technical_person_id) or any additional co-assignee
// (project_technical_assignments) — for the AI Daily Report's project picker
// (app/api/daily-reports/tms-projects). They're already authorized on these
// deals; this just surfaces ongoing Sales-side work the same dropdown that
// already lists their TMS projects, so picking one logs a plain note against
// it (no TMS task, no further linking — see lib/dailyReportTemplates.ts's
// AI_TEMPLATE `sales_project_id` field).
export interface SelectableSalesProject {
  id: string;
  name: string;
  status: ProjectStatus;
  /**
   * True when this employee is personally an assigned technical person on it
   * (primary or co-assignee). Their own projects sort first and the picker
   * labels them, so a long list still leads with the few that are theirs.
   */
  mine: boolean;
}

/**
 * Sales Projects the AI Daily Report's picker may offer.
 *
 * Scoped with resolveOwnerWhere — the SAME rule the Projects page itself
 * uses — so the two screens agree about what this person's projects are.
 * The previous version matched only `assigned_technical_person_id` plus
 * co-assignments, which is a narrower idea of "theirs" than the Projects
 * page has: that page also counts projects they created and ones they are
 * the lead on, and expands through their department scope. For a manager
 * the gap was large — one AI manager saw 33 active projects on the Projects
 * page and was offered 18 here, with no way to pick the rest.
 *
 * Status: everything except 'lost'. The old filter was `status: 'active'`
 * exactly, which dropped WON projects — and a won deal is precisely when
 * delivery and installation work happens, so those are the ones most likely
 * to need a daily report against them. 'on_hold' is kept for the same
 * reason: on hold is not finished. Only a lost deal has no future work.
 *
 * Resolved for the EMPLOYEE whose report it is, not the viewer — a manager
 * filing on someone's behalf must see that person's projects, not their own.
 */
export async function listSelectableSalesProjects(employeeUsername: string, employeeId: string): Promise<SelectableSalesProject[]> {
  if (!isUuid(employeeId) || !employeeUsername) return [];

  const ownerWhere = await resolveOwnerWhere(employeeUsername);
  const rows = await db.Project.findAll({
    where: { ...ownerWhere, status: { [Op.ne]: 'lost' } } as never,
    attributes: ['id', 'project_name', 'client_name', 'company', 'status', 'assigned_technical_person_id'],
    order: [['created_at', 'DESC']]
  });

  // One query for "which of these is she actually on", rather than one per
  // row — the co-assignee table is the only way to know for the non-primary
  // case.
  const ownAssignments = await db.ProjectTechnicalAssignment.findAll({
    where: { user_id: employeeId } as never,
    attributes: ['project_id']
  });
  const ownProjectIds = new Set(ownAssignments.map((r) => r.get('project_id') as string));

  const projects = rows.map((r) => {
    const p = r.get({ plain: true }) as {
      id: string;
      project_name?: string;
      client_name?: string;
      company?: string;
      status: ProjectStatus;
      assigned_technical_person_id?: string;
    };
    return {
      id: p.id,
      name: projectLabel(p),
      status: p.status,
      mine: p.assigned_technical_person_id === employeeId || ownProjectIds.has(p.id)
    };
  });

  // Theirs first, the rest in the query's newest-first order. A stable sort
  // keeps that second ordering intact within each group.
  return projects.sort((a, b) => Number(b.mine) - Number(a.mine));
}

// Appends one timeline entry and, when `advanceStageTo` is given, moves the
// project's current stage/status forward. Called from every linked module's
// API route (site visit, quotation, demo, customer response, negotiation,
// PO, installation) whenever a record carries a project_id, so the Project
// Timeline stays complete without any manual step.
export async function appendProjectTimeline(
  projectId: string,
  event: { by: string; stage: ProjectStage | 'created'; label: string; remarks?: string },
  advanceStageTo?: ProjectStage
): Promise<ProjectRecord | null> {
  if (!projectId || !isUuid(projectId)) return null;
  const row = await db.Project.findByPk(projectId);
  if (!row) return null;

  return sequelize.transaction(async (t) => {
    await db.ProjectTimelineEvent.create(
      { project_id: projectId, at: new Date(), by: event.by, stage: event.stage, label: event.label, remarks: event.remarks || '' } as never,
      { transaction: t }
    );
    const current = row.get({ plain: true }) as Record<string, unknown>;
    // The other way a stage moves (the route uses this, not update(), when
    // the stage itself changes), so the override has to be discarded here
    // too — see update() above for why.
    const overrideCleared = advanceStageTo
      && clearOverrideOnStageChange(current.stage as ProjectStage, advanceStageTo)
      ? {
          closing_percent_override: null,
          closing_percent_override_reason: '',
          closing_percent_override_by: null,
          closing_percent_override_at: null,
          stage_entered_at: new Date()
        }
      : {};
    await row.update(
      {
        ...overrideCleared,
        stage: advanceStageTo || current.stage,
        status: advanceStageTo === 'completed' ? 'won' : advanceStageTo === 'closed_lost' ? 'lost' : current.status,
        // See ProjectRecord.closed_at / update()'s own version of this rule —
        // 'closed_lost' is how "Close Project → Lost" actually reaches the
        // DB (as an advanceStageTo, not a plain status patch), so it needs
        // the same stamp here.
        closed_at: advanceStageTo === 'completed' || advanceStageTo === 'closed_lost' ? new Date() : current.closed_at
      } as never,
      { transaction: t }
    );
    const withAssoc = await db.Project.findByPk(projectId, { include: allIncludes, transaction: t });
    return normalizeProject(toRecord(withAssoc as Model));
  });
}
