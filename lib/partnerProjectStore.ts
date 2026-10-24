import { Model } from 'sequelize';
import { db, isUuid, sequelize } from './db';
import { ProjectRecord } from './types';
import { findPartnerById } from './partnerStore';
import { PartnerSubmissionStatus, canReviewTransition } from './partnerProjectStages';
import { PARTNER_REVIEW_EVENT_LABEL, PARTNER_SUBMISSION_EVENT_LABEL } from './partnerReviewThread';
import { SubmissionChange, formatChangeSummary, summariseSubmissionChanges } from './partnerSubmissionDiff';
import { PartnerVisibleProject, toPartnerVisibleProject } from './partnerVisibility';

// Partner-sourced projects: intake, the partner's own reads, and the Sales
// review that accepts or refuses a submission.
//
// Every read here puts partner_id in the WHERE clause. Not a post-filter, not
// an `if` after the fetch — the query itself must be incapable of returning
// another partner's row, because a post-filter is one early-return away from
// leaking and leaves no trace when it does.

export class PartnerSubmissionError extends Error {}

export interface PartnerSubmissionInput {
  // Mirrors the internal New Project form (components/ProjectsView.tsx) field
  // for field, minus the three INTERNAL-PERSON pickers — sales person,
  // technical person(s) and project lead. Those are the sales manager's call
  // at review time, not the partner's.
  project_name: string;
  client_name: string;
  company: string;
  contact_person?: string;
  alt_contact_phone?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  opportunity_type?: string;
  departments?: string[];
  priority?: string;
  expected_closing_date?: string;
  remarks?: string;
  partner_submitted_value?: number | '';
  partner_expected_timeline?: string;
  attachments?: string[];
}

const PRIORITIES = ['low', 'medium', 'high'];
const OPPORTUNITY_TYPES = ['distribution', 'project'];

/**
 * Create a project from a partner submission.
 *
 * created_by is set to the partner's RELATIONSHIP MANAGER, not the
 * submitting partner user. This is the decision flagged in the plan, and it
 * is load-bearing: created_by is the project's sales-owner key that
 * lib/departmentScope.ts and canAccessProject resolve visibility from.
 * Pointing it at an external account would put a partner inside the internal
 * visibility graph — their "department" would start scoping internal
 * records, and every existing query that joins created_by -> users -> department
 * would quietly start returning nonsense for these rows.
 *
 * The partner is still recorded, permanently and unambiguously, in
 * partner_id. Nothing about attribution is lost; what changes is which
 * INTERNAL person the row hangs off for visibility purposes.
 *
 * Consequence to be aware of: an unreviewed submission is visible to the RM
 * (and whoever manages them) from the moment it arrives. If a partner has no
 * RM assigned, created_by is NULL and the submission is visible only to
 * org-wide viewers until someone assigns one.
 */
export async function submitPartnerProject(
  partnerId: string,
  input: PartnerSubmissionInput,
  submittedByUsername: string
): Promise<ProjectRecord> {
  if (!isUuid(partnerId)) throw new PartnerSubmissionError('Unknown partner');
  const partner = await findPartnerById(partnerId);
  if (!partner) throw new PartnerSubmissionError('Unknown partner');
  if (!input.client_name?.trim() && !input.company?.trim()) {
    throw new PartnerSubmissionError('Customer name or company is required');
  }

  return sequelize.transaction(async (t) => {
    const row = await db.Project.create(
      {
        project_name: input.project_name?.trim() || '',
        client_name: input.client_name?.trim() || '',
        company: input.company?.trim() || '',
        contact_person: input.contact_person?.trim() || '',
        alt_contact_phone: input.alt_contact_phone?.trim() || '',
        phone: input.phone?.trim() || '',
        email: input.email?.trim() || '',
        address: input.address?.trim() || '',
        city: input.city?.trim() || '',
        state: input.state?.trim() || '',
        opportunity_type: OPPORTUNITY_TYPES.includes(input.opportunity_type ?? '') ? input.opportunity_type : null,
        departments: input.departments || [],
        // department_amounts is deliberately NOT accepted. The split is
        // defined as a division of approx_price — which Sales sets on
        // acceptance and is NULL until then. Storing a split against a value
        // nobody has vetted would put unreviewed partner numbers into every
        // report that sums department_amounts, which is exactly what keeping
        // their estimate out of approx_price exists to prevent.
        department_amounts: {},
        expected_closing_date: input.expected_closing_date || null,
        remarks: input.remarks?.trim() || '',
        attachments: input.attachments || [],
        // 'Partner' joins the existing PROJECT_SOURCE_OPTIONS list so the
        // Projects list's Source filter works with no special-casing.
        source: 'Partner',
        // Starts at the pipeline's beginning like any other new project —
        // 'prospect', the live first stage (lib/projectStages.ts). The
        // partner is NOT shown this value: resolvePartnerStage gates every
        // stage reading behind the submission status, so an unreviewed
        // project reads as "awaiting sales review", not "prospect".
        stage: 'prospect',
        status: 'active',
        priority: PRIORITIES.includes(input.priority ?? '') ? input.priority : 'medium',
        partner_id: partnerId,
        partner_submission_status: 'submitted',
        partner_submitted_value: input.partner_submitted_value === '' || input.partner_submitted_value === undefined ? null : input.partner_submitted_value,
        partner_expected_timeline: input.partner_expected_timeline?.trim() || '',
        // See the function comment. NULL when the partner has no RM yet.
        created_by: partner.relationship_manager_id || null,
        // sales_person is free text used across reporting; left blank until
        // Sales actually assigns someone, so an unreviewed submission never
        // appears in anyone's achievement numbers.
        sales_person: ''
      } as never,
      { transaction: t }
    );

    const projectId = row.get('id') as string;
    await db.ProjectTimelineEvent.create(
      {
        project_id: projectId,
        at: new Date(),
        by: submittedByUsername,
        stage: 'created',
        label: PARTNER_SUBMISSION_EVENT_LABEL,
        remarks: `${partner.company_name} (${partner.partner_code})`,
        // The partner's own milestone — one of the few events that starts
        // life visible to them. See the 20261020094000 migration.
        partner_visible: true
      } as never,
      { transaction: t }
    );

    // The partner's own description, kept as a partner-visible note.
    //
    // It also goes into project.remarks for the sales team — but remarks is
    // a shared field a salesperson will later edit with internal commentary,
    // so the partner-facing copy cannot read from there. This note is
    // written once and nothing internal rewrites it.
    if (input.remarks?.trim()) {
      await db.ProjectNote.create(
        {
          project_id: projectId,
          at: new Date(),
          by: submittedByUsername,
          text: input.remarks.trim(),
          partner_visible: true
        } as never,
        { transaction: t }
      );
    }

    const created = await db.Project.findByPk(projectId, { transaction: t });
    return (created as Model).get({ plain: true }) as unknown as ProjectRecord;
  });
}

const partnerProjectIncludes = [
  { model: db.ProjectNote, as: 'notes' },
  { model: db.ProjectTimelineEvent, as: 'timeline' },
  { model: db.User, as: 'creator', attributes: ['id', 'username', 'name'] }
];

function plainToProjectRecord(row: Model): ProjectRecord {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  return {
    ...plain,
    // See the note in lib/partnerDemoStore.ts — the attribute is createdAt.
    created_at: plain.createdAt instanceof Date ? plain.createdAt.toISOString() : String(plain.createdAt ?? ''),
    notes: ((plain.notes as Record<string, unknown>[]) ?? []).map((n) => ({
      id: n.id as string,
      at: n.at instanceof Date ? n.at.toISOString() : String(n.at ?? ''),
      by: (n.by as string) ?? '',
      text: (n.text as string) ?? '',
      partner_visible: n.partner_visible === true
    })),
    timeline: ((plain.timeline as Record<string, unknown>[]) ?? []).map((e) => ({
      id: e.id as string,
      at: e.at instanceof Date ? e.at.toISOString() : String(e.at ?? ''),
      by: (e.by as string) ?? '',
      stage: e.stage,
      label: (e.label as string) ?? '',
      remarks: (e.remarks as string) ?? '',
      partner_visible: e.partner_visible === true
    })),
    partner_reviewed_at: plain.partner_reviewed_at instanceof Date ? plain.partner_reviewed_at.toISOString() : String(plain.partner_reviewed_at ?? ''),
    partner_submitted_value: plain.partner_submitted_value === null || plain.partner_submitted_value === undefined ? '' : Number(plain.partner_submitted_value)
  } as unknown as ProjectRecord;
}

/** The salesperson's display name, or '' — never their username or id. */
function salespersonNameOf(row: Model): string {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  // sales_person is only the ASSIGNED test — an empty one means nobody owns
  // this yet, and the portal says "Not yet assigned".
  const salesPerson = (plain.sales_person as string) || '';
  if (!salesPerson) return '';

  // Resolve a real display name from the owning user record. The
  // sales_person COLUMN is deliberately not used as the answer: it is free
  // text that holds usernames far more often than names, so returning it
  // would hand the partner an internal account handle.
  //
  // Honest limitation: if that account has no display name set, the app-wide
  // `name || username` convention applies and a username can still appear —
  // there is no better handle, and leaving the field blank would wrongly
  // read as "nobody is assigned".
  const creator = plain.creator as { name?: string; username?: string } | null;
  return creator?.name || creator?.username || salesPerson;
}

async function contextFor(projectId: string, partnerId: string, row: Model) {
  const [demos, sharedQuotations] = await Promise.all([
    db.DemoSchedule.count({ where: { project_id: projectId } as never }),
    // A quotation counts as shared ONLY through an explicit, non-revoked
    // share row scoped to THIS partner. Counting quotations on the project
    // instead would tell a partner "quotation shared" for a draft they must
    // never see — see lib/partnerQuotationStore.ts.
    db.PartnerQuotationShare.count({
      where: { partner_id: partnerId, revoked_at: null } as never,
      include: [{ model: db.Quotation, as: 'quotation', attributes: [], where: { project_id: projectId } as never, required: true }]
    })
  ]);
  return {
    hasSharedQuotation: sharedQuotations > 0,
    hasDemo: demos > 0,
    salespersonName: salespersonNameOf(row)
  };
}

export async function listPartnerProjects(partnerId: string): Promise<PartnerVisibleProject[]> {
  if (!isUuid(partnerId)) return [];
  const rows = await db.Project.findAll({
    where: { partner_id: partnerId } as never,
    include: partnerProjectIncludes,
    order: [['created_at', 'DESC']]
  });
  return Promise.all(
    rows.map(async (row) =>
      toPartnerVisibleProject(plainToProjectRecord(row), await contextFor(row.get('id') as string, partnerId, row))
    )
  );
}

export async function findPartnerProject(partnerId: string, projectId: string): Promise<PartnerVisibleProject | undefined> {
  if (!isUuid(partnerId) || !isUuid(projectId)) return undefined;
  const row = await db.Project.findOne({
    // BOTH ids in the WHERE. A project id belonging to another partner — or
    // to an internal direct project — simply does not resolve, so the route
    // returns 404 without having to remember a separate ownership check.
    where: { id: projectId, partner_id: partnerId } as never,
    include: partnerProjectIncludes
  });
  if (!row) return undefined;
  return toPartnerVisibleProject(plainToProjectRecord(row), await contextFor(projectId, partnerId, row));
}

export interface ReviewInput {
  decision: PartnerSubmissionStatus;
  remarks: string;
  reviewerUserId: string;
  reviewerUsername: string;
  /** Set on approval: the sales person who takes the project forward. */
  salesPersonUsername?: string;
  salesPersonUserId?: string;
  /** Set on approval: Sales' own vetted value, which becomes approx_price. */
  approxPrice?: number;
}

/**
 * Sales accepts, refuses, or asks for more on a partner submission.
 *
 * Writes a partner-visible timeline event for every outcome — a partner
 * whose submission was refused with no explanation is the worst version of
 * this feature, and "awaiting review" forever is the second worst.
 */
export async function reviewPartnerSubmission(projectId: string, input: ReviewInput): Promise<ProjectRecord | undefined> {
  if (!isUuid(projectId)) return undefined;
  const row = await db.Project.findByPk(projectId);
  if (!row) return undefined;

  const partnerId = row.get('partner_id') as string | null;
  if (!partnerId) throw new PartnerSubmissionError('This project was not submitted by a partner');

  const from = (row.get('partner_submission_status') as string) || '';
  if (!canReviewTransition(from, input.decision)) {
    throw new PartnerSubmissionError(`A ${from || 'non-partner'} submission cannot be moved to ${input.decision}`);
  }
  if (input.decision === 'rejected' && !input.remarks.trim()) {
    throw new PartnerSubmissionError('A reason is required when refusing a submission');
  }
  if (input.decision === 'info_requested' && !input.remarks.trim()) {
    throw new PartnerSubmissionError('Say what information is needed');
  }

  return sequelize.transaction(async (t) => {
    const attrs: Record<string, unknown> = {
      partner_submission_status: input.decision,
      partner_reviewed_by: input.reviewerUserId,
      partner_reviewed_at: new Date(),
      partner_review_remarks: input.remarks.trim()
    };

    if (input.decision === 'approved') {
      // Assignment happens as part of acceptance: an approved submission
      // with nobody on it is the state this workflow exists to prevent.
      if (input.salesPersonUsername) {
        attrs.sales_person = input.salesPersonUsername;
        if (input.salesPersonUserId) attrs.created_by = input.salesPersonUserId;
      }
      // Sales' own vetted figure becomes the forecast number. The partner's
      // estimate stays untouched in partner_submitted_value, so the two can
      // be compared later.
      if (typeof input.approxPrice === 'number' && input.approxPrice > 0) {
        attrs.approx_price = input.approxPrice;
      }
    }

    await row.update(attrs as never, { transaction: t });

    // From the shared constants, not literals: lib/partnerReviewThread.ts
    // derives who wrote an event from its label, so the two must never drift.
    const label = PARTNER_REVIEW_EVENT_LABEL[input.decision as 'approved' | 'rejected' | 'info_requested'];

    await db.ProjectTimelineEvent.create(
      {
        project_id: projectId,
        at: new Date(),
        by: input.reviewerUsername,
        stage: 'created',
        label,
        remarks: input.remarks.trim(),
        partner_visible: true
      } as never,
      { transaction: t }
    );

    const fresh = await db.Project.findByPk(projectId, { transaction: t });
    return (fresh as Model).get({ plain: true }) as unknown as ProjectRecord;
  });
}

/**
 * The partner answering an information request.
 *
 * Moves the submission back to 'submitted' so it re-enters the review queue
 * — otherwise a partner could reply and have it sit in info_requested with
 * nobody prompted to look again.
 */
export async function respondToInfoRequest(partnerId: string, projectId: string, message: string, byUsername: string): Promise<boolean> {
  if (!isUuid(partnerId) || !isUuid(projectId)) return false;
  if (!message.trim()) throw new PartnerSubmissionError('A message is required');

  const row = await db.Project.findOne({ where: { id: projectId, partner_id: partnerId } as never });
  if (!row) return false;
  if ((row.get('partner_submission_status') as string) !== 'info_requested') {
    throw new PartnerSubmissionError('This project is not waiting on information');
  }

  await sequelize.transaction(async (t) => {
    await row.update({ partner_submission_status: 'submitted' } as never, { transaction: t });
    await db.ProjectNote.create(
      {
        project_id: projectId,
        at: new Date(),
        by: byUsername,
        text: message.trim(),
        // The partner wrote it, so the partner can see it.
        partner_visible: true
      } as never,
      { transaction: t }
    );
  });
  return true;
}

/**
 * The partner REVISING their submission after Sales asked for changes.
 *
 * Only while partner_submission_status is 'info_requested'. That gate is the
 * whole safety model: before review the submission is theirs to correct, and
 * once accepted it is an ordinary MatrixIQ project that Sales is working —
 * letting an external account rewrite the customer name, value or closing
 * date underneath a live quotation is exactly what must not happen.
 *
 * Writes the same two things a reply writes — a partner-visible note and a
 * return to 'submitted' — plus a named list of what moved, so the reviewer
 * who asked for the change can see it was made without re-reading the form.
 */
export type PartnerRevisionInput = Partial<PartnerSubmissionInput>;

export async function reviseSubmission(
  partnerId: string,
  projectId: string,
  input: PartnerRevisionInput,
  message: string,
  byUsername: string
): Promise<{ changes: SubmissionChange[] } | null> {
  if (!isUuid(partnerId) || !isUuid(projectId)) return null;

  const row = await db.Project.findOne({ where: { id: projectId, partner_id: partnerId } as never });
  if (!row) return null;
  if ((row.get('partner_submission_status') as string) !== 'info_requested') {
    throw new PartnerSubmissionError('This project is not open for changes');
  }
  const before = row.get({ plain: true }) as Record<string, unknown>;

  // Checked against what the project would END UP with, not against the
  // payload alone: a revision that touches only the phone number must not be
  // refused for "missing" a name it was never going to change.
  const nextClient = input.client_name === undefined ? String(before.client_name ?? '') : input.client_name;
  const nextCompany = input.company === undefined ? String(before.company ?? '') : input.company;
  if (!nextClient.trim() && !nextCompany.trim()) {
    throw new PartnerSubmissionError('Customer name or company is required');
  }

  // Built field by field from the same allow-list the create path uses — the
  // body is never spread. A partner revising must not be able to reach
  // sales_person, stage, status, approx_price or partner_submission_status.
  // A field the revision did not mention is LEFT ALONE, not cleared. The
  // create path can default a missing field to empty because there is
  // nothing to lose; here, a form that posts a subset would otherwise wipe
  // the attachments or the description the partner never touched.
  const next: Record<string, unknown> = {};
  const put = (key: string, value: unknown) => {
    if (value !== undefined) next[key] = value;
  };
  const text = (value: string | undefined) => (value === undefined ? undefined : value.trim());

  put('project_name', text(input.project_name));
  put('client_name', text(input.client_name));
  put('company', text(input.company));
  put('contact_person', text(input.contact_person));
  put('alt_contact_phone', text(input.alt_contact_phone));
  put('phone', text(input.phone));
  put('email', text(input.email));
  put('address', text(input.address));
  put('city', text(input.city));
  put('state', text(input.state));
  put(
    'opportunity_type',
    input.opportunity_type === undefined ? undefined : OPPORTUNITY_TYPES.includes(input.opportunity_type) ? input.opportunity_type : null
  );
  put('departments', input.departments);
  put('expected_closing_date', input.expected_closing_date === undefined ? undefined : input.expected_closing_date || null);
  put('remarks', text(input.remarks));
  put('attachments', input.attachments);
  put('priority', input.priority === undefined ? undefined : PRIORITIES.includes(input.priority) ? input.priority : 'medium');
  put(
    'partner_submitted_value',
    input.partner_submitted_value === undefined ? undefined : input.partner_submitted_value === '' ? null : input.partner_submitted_value
  );
  put('partner_expected_timeline', text(input.partner_expected_timeline));

  const changes = summariseSubmissionChanges(before, next);
  if (!changes.length && !message.trim()) {
    throw new PartnerSubmissionError('Make a change or add a message before sending this back');
  }

  await sequelize.transaction(async (t) => {
    await row.update({ ...next, partner_submission_status: 'submitted' } as never, { transaction: t });

    const summary = formatChangeSummary(changes);
    const text = [message.trim(), summary && `Updated:\n${summary}`].filter(Boolean).join('\n\n');

    await db.ProjectNote.create(
      {
        project_id: projectId,
        at: new Date(),
        by: byUsername,
        text,
        // The partner wrote it, and the reviewer who asked for the change
        // needs to read it — visible to both.
        partner_visible: true
      } as never,
      { transaction: t }
    );
  });

  return { changes };
}

/** Submissions awaiting a decision — the internal review queue. */
export async function listSubmissionsAwaitingReview(): Promise<ProjectRecord[]> {
  const rows = await db.Project.findAll({
    where: { partner_submission_status: ['submitted', 'info_requested'] } as never,
    include: [{ model: db.Partner, as: 'partner', attributes: ['id', 'company_name', 'partner_code'] }],
    order: [['created_at', 'ASC']]
  });
  return rows.map((r) => r.get({ plain: true }) as unknown as ProjectRecord);
}
