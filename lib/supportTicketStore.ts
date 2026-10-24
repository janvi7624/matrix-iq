import { Model, Op } from 'sequelize';
import { db, isUuid, sequelize } from './db';
import {
  SupportActor,
  SupportTicketStatus,
  canTransition,
  isSupportTicketStatus,
  partnerFacingStatus,
  transitionRequiresReason
} from './supportTicketWorkflow';
import { SlaAssessment, SlaPolicy, assessSla, computeDueDates } from './supportSla';

export class SupportTicketError extends Error {}

// Support tickets: creation, the internal queues, the partner's own view,
// and every status transition. The workflow rules live in
// lib/supportTicketWorkflow.ts and the SLA arithmetic in lib/supportSla.ts;
// this file is the database side.

export interface SupportTicketView {
  id: string;
  ticket_number: string;
  title: string;
  description: string;
  category: string;
  issue_type: string;
  product: string;
  model_serial: string;
  customer_name: string;
  location: string;
  priority: string;
  status: SupportTicketStatus;
  created_at: string;
  occurred_on: string;
  partner_id: string;
  partner_name: string;
  assignee_name: string;
  assignee_id: string;
  created_by_name: string;
  resolution_summary: string;
  root_cause: string;
  corrective_action: string;
  attachments: string[];
  reopened_count: number;
  first_response_at: string;
  resolved_at: string;
  closed_at: string;
  response_due_at: string;
  resolution_due_at: string;
  sla: SlaAssessment | null;
}

export interface SupportComment {
  id: string;
  body: string;
  is_internal: boolean;
  author_name: string;
  created_at: string;
  attachments: string[];
}

function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

async function policyFor(priority: string): Promise<SlaPolicy | null> {
  const row = await db.SupportSlaPolicy.findOne({ where: { priority, status: 'active' } as never });
  if (!row) return null;
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  return {
    priority: plain.priority as string,
    firstResponseMinutes: Number(plain.first_response_minutes) || 0,
    resolutionMinutes: Number(plain.resolution_minutes) || 0,
    pauseOnAwaitingPartner: plain.pause_on_awaiting_partner === true,
    businessHoursOnly: plain.business_hours_only === true,
    escalateAfterMinutes: plain.escalate_after_minutes === null || plain.escalate_after_minutes === undefined ? null : Number(plain.escalate_after_minutes)
  };
}

const ticketIncludes = [
  { model: db.Partner, as: 'partner', attributes: ['id', 'company_name', 'partner_code'], required: false },
  { model: db.User, as: 'assignee', attributes: ['id', 'name', 'username'], required: false },
  { model: db.User, as: 'creator', attributes: ['id', 'name', 'username'], required: false }
];

function toView(plain: Record<string, unknown>, sla: SlaAssessment | null, forPartner: boolean): SupportTicketView {
  const partner = plain.partner as { company_name?: string; partner_code?: string } | null;
  const assignee = plain.assignee as { id?: string; name?: string; username?: string } | null;
  const creator = plain.creator as { name?: string; username?: string } | null;
  const rawStatus = (plain.status as SupportTicketStatus) ?? 'new';
  return {
    id: plain.id as string,
    ticket_number: (plain.ticket_number as string) ?? '',
    title: (plain.title as string) ?? '',
    description: (plain.description as string) ?? '',
    category: (plain.category as string) ?? '',
    issue_type: (plain.issue_type as string) ?? '',
    product: (plain.product as string) ?? '',
    model_serial: (plain.model_serial as string) ?? '',
    customer_name: (plain.customer_name as string) ?? '',
    location: (plain.location as string) ?? '',
    priority: (plain.priority as string) ?? 'medium',
    // A partner never sees internal queue states — see partnerFacingStatus.
    status: forPartner ? partnerFacingStatus(rawStatus) : rawStatus,
    created_at: isoOrEmpty(plain.createdAt),
    occurred_on: (plain.occurred_on as string) ?? '',
    partner_id: (plain.partner_id as string) ?? '',
    partner_name: partner ? `${partner.company_name} (${partner.partner_code})` : '',
    // Who is working on it is partner-facing (they need a name), but never
    // the username or id.
    assignee_name: assignee?.name || assignee?.username || '',
    assignee_id: forPartner ? '' : (assignee?.id ?? ''),
    created_by_name: forPartner ? '' : creator?.name || creator?.username || '',
    resolution_summary: (plain.resolution_summary as string) ?? '',
    // Root cause and corrective action are engineering records. Shown to the
    // partner too: they are the substance of "what was wrong and what we
    // did", which the requirement asks resolved tickets to carry.
    root_cause: (plain.root_cause as string) ?? '',
    corrective_action: (plain.corrective_action as string) ?? '',
    attachments: stringList(plain.attachments),
    reopened_count: Number(plain.reopened_count) || 0,
    first_response_at: isoOrEmpty(plain.first_response_at),
    resolved_at: isoOrEmpty(plain.resolved_at),
    closed_at: isoOrEmpty(plain.closed_at),
    // SLA timings are an internal commitment and a management metric — a
    // partner is told the status, not how close we are to missing a target.
    response_due_at: forPartner ? '' : isoOrEmpty(plain.response_due_at),
    resolution_due_at: forPartner ? '' : isoOrEmpty(plain.resolution_due_at),
    sla: forPartner ? null : sla
  };
}

async function historyFor(ticketId: string): Promise<{ from_status: string | null; to_status: string; at: string }[]> {
  const rows = await db.SupportTicketStatusHistory.findAll({
    where: { ticket_id: ticketId } as never,
    order: [['at', 'ASC']]
  });
  return rows.map((r) => {
    const plain = r.get({ plain: true }) as Record<string, unknown>;
    return {
      from_status: (plain.from_status as string) ?? null,
      to_status: plain.to_status as string,
      at: isoOrEmpty(plain.at)
    };
  });
}

async function slaFor(plain: Record<string, unknown>): Promise<SlaAssessment | null> {
  const policy = await policyFor((plain.priority as string) ?? 'medium');
  if (!policy) return null;
  return assessSla({
    createdAt: isoOrEmpty(plain.createdAt),
    responseDueAt: isoOrEmpty(plain.response_due_at),
    resolutionDueAt: isoOrEmpty(plain.resolution_due_at),
    firstResponseAt: isoOrEmpty(plain.first_response_at),
    resolvedAt: isoOrEmpty(plain.resolved_at),
    closedAt: isoOrEmpty(plain.closed_at),
    status: (plain.status as string) ?? 'new',
    history: await historyFor(plain.id as string),
    policy
  });
}

/**
 * TKT-YYYY-NNNN, derived from the highest existing number in the current
 * year rather than a count — deleting a ticket must never cause the next one
 * to reuse a retired reference, which customers quote back at us.
 */
export async function nextTicketNumber(now: Date = new Date()): Promise<string> {
  const year = now.getFullYear();
  const rows = await db.SupportTicket.findAll({
    where: { ticket_number: { [Op.like]: `TKT-${year}-%` } } as never,
    attributes: ['ticket_number'],
    paranoid: false
  });
  let max = 0;
  for (const row of rows) {
    const match = new RegExp(`^TKT-${year}-(\\d+)$`).exec((row.get('ticket_number') as string) || '');
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `TKT-${year}-${String(max + 1).padStart(4, '0')}`;
}

export interface CreateTicketInput {
  title: string;
  description: string;
  category?: string;
  issueType?: string;
  product?: string;
  modelSerial?: string;
  customerName?: string;
  location?: string;
  priority?: string;
  occurredOn?: string;
  projectId?: string;
  contactPerson?: string;
  contactMethod?: string;
  attachments?: string[];
}

const PRIORITIES = ['low', 'medium', 'high', 'critical'];

export async function createTicket(
  input: CreateTicketInput,
  createdByUserId: string,
  partnerId: string | null
): Promise<{ id: string; ticket_number: string }> {
  if (!input.title?.trim()) throw new SupportTicketError('A title is required');
  if (!input.description?.trim()) throw new SupportTicketError('Describe the issue');

  const priority = PRIORITIES.includes(input.priority ?? '') ? (input.priority as string) : 'medium';

  // A project may be linked only if it belongs to the raising partner.
  let projectId: string | null = null;
  if (input.projectId && isUuid(input.projectId)) {
    const where = partnerId ? { id: input.projectId, partner_id: partnerId } : { id: input.projectId };
    const project = await db.Project.findOne({ where: where as never, attributes: ['id'] });
    if (!project) throw new SupportTicketError('That project could not be found');
    projectId = project.get('id') as string;
  }

  return sequelize.transaction(async (t) => {
    const ticketNumber = await nextTicketNumber();
    const row = await db.SupportTicket.create(
      {
        ticket_number: ticketNumber,
        partner_id: partnerId,
        created_by_user_id: createdByUserId,
        project_id: projectId,
        title: input.title.trim(),
        description: input.description.trim(),
        category: input.category?.trim() || null,
        issue_type: input.issueType?.trim() || null,
        product: input.product?.trim() || null,
        model_serial: input.modelSerial?.trim() || null,
        customer_name: input.customerName?.trim() || null,
        location: input.location?.trim() || null,
        priority,
        status: 'new',
        occurred_on: input.occurredOn || null,
        contact_person: input.contactPerson?.trim() || null,
        contact_method: input.contactMethod?.trim() || null,
        attachments: input.attachments || []
      } as never,
      { transaction: t }
    );

    const id = row.get('id') as string;
    await db.SupportTicketStatusHistory.create(
      { ticket_id: id, from_status: null, to_status: 'new', by_user_id: createdByUserId, at: new Date() } as never,
      { transaction: t }
    );
    return { id, ticket_number: ticketNumber };
  });
}

/** The partner's own tickets. partner_id is in the WHERE, never a post-filter. */
export async function listPartnerTickets(partnerId: string): Promise<SupportTicketView[]> {
  if (!isUuid(partnerId)) return [];
  const rows = await db.SupportTicket.findAll({
    where: { partner_id: partnerId } as never,
    include: ticketIncludes,
    order: [['created_at', 'DESC']]
  });
  return rows.map((r) => toView(r.get({ plain: true }) as Record<string, unknown>, null, true));
}

export async function findPartnerTicket(partnerId: string, ticketId: string): Promise<{ ticket: SupportTicketView; comments: SupportComment[] } | undefined> {
  if (!isUuid(partnerId) || !isUuid(ticketId)) return undefined;
  const row = await db.SupportTicket.findOne({
    where: { id: ticketId, partner_id: partnerId } as never,
    include: ticketIncludes
  });
  if (!row) return undefined;
  return {
    ticket: toView(row.get({ plain: true }) as Record<string, unknown>, null, true),
    // is_internal:false in the WHERE — internal diagnostic notes are never
    // fetched for a partner, let alone filtered out afterwards.
    comments: await listComments(ticketId, false)
  };
}

export interface InternalTicketFilters {
  queue?: string;
  assigneeId?: string;
}

/** The internal queues. */
export async function listInternalTickets(filters: InternalTicketFilters, viewerUserId: string): Promise<SupportTicketView[]> {
  const where: Record<string, unknown> = {};
  switch (filters.queue) {
    case 'unassigned':
      where.assigned_to_id = null;
      where.status = { [Op.notIn]: ['closed', 'cancelled'] };
      break;
    case 'mine':
      where.assigned_to_id = viewerUserId;
      where.status = { [Op.notIn]: ['closed', 'cancelled'] };
      break;
    case 'escalated':
      where.status = 'escalated';
      break;
    case 'awaiting_partner':
      where.status = 'awaiting_partner';
      break;
    case 'resolved':
      where.status = 'resolved';
      break;
    case 'closed':
      where.status = { [Op.in]: ['closed', 'cancelled'] };
      break;
    case 'open':
    default:
      where.status = { [Op.notIn]: ['closed', 'cancelled'] };
      break;
  }
  if (filters.assigneeId) where.assigned_to_id = filters.assigneeId;

  const rows = await db.SupportTicket.findAll({ where: where as never, include: ticketIncludes, order: [['created_at', 'DESC']] });
  return Promise.all(
    rows.map(async (r) => {
      const plain = r.get({ plain: true }) as Record<string, unknown>;
      return toView(plain, await slaFor(plain), false);
    })
  );
}

export async function findTicketById(ticketId: string): Promise<{ ticket: SupportTicketView; raw: Record<string, unknown>; comments: SupportComment[]; history: { from_status: string | null; to_status: string; at: string }[] } | undefined> {
  if (!isUuid(ticketId)) return undefined;
  const row = await db.SupportTicket.findByPk(ticketId, { include: ticketIncludes });
  if (!row) return undefined;
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  return {
    ticket: toView(plain, await slaFor(plain), false),
    raw: plain,
    comments: await listComments(ticketId, true),
    history: await historyFor(ticketId)
  };
}

export async function listComments(ticketId: string, includeInternal: boolean): Promise<SupportComment[]> {
  const where: Record<string, unknown> = { ticket_id: ticketId };
  if (!includeInternal) where.is_internal = false;
  const rows = await db.SupportTicketComment.findAll({
    where: where as never,
    include: [{ model: db.User, as: 'author', attributes: ['name', 'username'], required: false }],
    order: [['created_at', 'ASC']]
  });
  return rows.map((r) => {
    const plain = r.get({ plain: true }) as Record<string, unknown>;
    const author = plain.author as { name?: string; username?: string } | null;
    return {
      id: plain.id as string,
      body: (plain.body as string) ?? '',
      is_internal: plain.is_internal === true,
      author_name: author?.name || author?.username || '',
      created_at: isoOrEmpty(plain.created_at),
      attachments: stringList(plain.attachments)
    };
  });
}

/**
 * Add a comment.
 *
 * isInternal is passed by the CALLER, never read from a request body at this
 * layer — the partner route hard-codes false, the internal route takes the
 * engineer's explicit choice.
 */
export async function addComment(
  ticketId: string,
  authorUserId: string,
  body: string,
  isInternal: boolean,
  attachments: string[] = []
): Promise<void> {
  if (!body.trim()) throw new SupportTicketError('Write a message');
  await sequelize.transaction(async (t) => {
    await db.SupportTicketComment.create(
      { ticket_id: ticketId, author_user_id: authorUserId, body: body.trim(), is_internal: isInternal, attachments } as never,
      { transaction: t }
    );
    // The first EXTERNAL reply is the first response for SLA purposes — an
    // internal note is us talking to ourselves and does not answer anyone.
    if (!isInternal) {
      const ticket = await db.SupportTicket.findByPk(ticketId, { transaction: t });
      if (ticket && !ticket.get('first_response_at')) {
        await ticket.update({ first_response_at: new Date() } as never, { transaction: t });
      }
    }
  });
}

export interface TransitionInput {
  ticketId: string;
  to: SupportTicketStatus;
  actor: SupportActor;
  byUserId: string;
  reason?: string;
  resolution?: { summary?: string; rootCause?: string; correctiveAction?: string };
}

export async function transitionTicket(input: TransitionInput): Promise<SupportTicketView | undefined> {
  if (!isUuid(input.ticketId)) return undefined;
  if (!isSupportTicketStatus(input.to)) throw new SupportTicketError('Unknown status');

  const row = await db.SupportTicket.findByPk(input.ticketId);
  if (!row) return undefined;

  const from = (row.get('status') as SupportTicketStatus) ?? 'new';
  if (!canTransition(from, input.to, input.actor)) {
    throw new SupportTicketError(`A ${from} ticket cannot be moved to ${input.to} by this role`);
  }
  if (transitionRequiresReason(input.to) && !input.reason?.trim()) {
    throw new SupportTicketError('A reason is required for this change');
  }

  return sequelize.transaction(async (t) => {
    const now = new Date();
    const attrs: Record<string, unknown> = { status: input.to };

    if (input.to === 'acknowledged' && !row.get('acknowledged_at')) attrs.acknowledged_at = now;
    if (input.to === 'resolved') {
      attrs.resolved_at = now;
      if (input.resolution?.summary) attrs.resolution_summary = input.resolution.summary.trim();
      if (input.resolution?.rootCause) attrs.root_cause = input.resolution.rootCause.trim();
      if (input.resolution?.correctiveAction) attrs.corrective_action = input.resolution.correctiveAction.trim();
    }
    if (input.to === 'closed') attrs.closed_at = now;
    if (input.to === 'escalated') attrs.escalated_at = now;
    if (input.to === 'reopened') {
      attrs.reopened_count = (Number(row.get('reopened_count')) || 0) + 1;
      // Clear the resolution stamps — the ticket is demonstrably not
      // resolved, and leaving them would make it count as met in SLA
      // reporting forever.
      attrs.resolved_at = null;
      attrs.closed_at = null;
    }

    await row.update(attrs as never, { transaction: t });
    await db.SupportTicketStatusHistory.create(
      { ticket_id: input.ticketId, from_status: from, to_status: input.to, by_user_id: input.byUserId, reason: input.reason?.trim() || null, at: now } as never,
      { transaction: t }
    );

    const fresh = await db.SupportTicket.findByPk(input.ticketId, { include: ticketIncludes, transaction: t });
    const plain = (fresh as Model).get({ plain: true }) as Record<string, unknown>;
    return toView(plain, null, false);
  });
}

/** Triage: set priority/department, stamp SLA due dates, assign an engineer. */
export async function triageTicket(
  ticketId: string,
  patch: { priority?: string; departmentId?: string | null; assigneeId?: string | null },
  byUserId: string
): Promise<SupportTicketView | undefined> {
  if (!isUuid(ticketId)) return undefined;
  const row = await db.SupportTicket.findByPk(ticketId);
  if (!row) return undefined;

  const attrs: Record<string, unknown> = {};
  const priority = patch.priority && PRIORITIES.includes(patch.priority) ? patch.priority : (row.get('priority') as string);
  if (patch.priority) attrs.priority = priority;
  if (patch.departmentId !== undefined) attrs.department_id = patch.departmentId || null;

  if (patch.assigneeId !== undefined) {
    attrs.assigned_to_id = patch.assigneeId || null;
    attrs.assigned_by_id = byUserId;
    attrs.assigned_at = patch.assigneeId ? new Date() : null;
  }

  // Stamp the due dates the first time the ticket is triaged, or restamp if
  // priority changed — a ticket upgraded to critical must be judged against
  // the critical target. Measured from CREATION; see computeDueDates.
  const policy = await policyFor(priority);
  if (policy && (!row.get('response_due_at') || patch.priority)) {
    const due = computeDueDates(isoOrEmpty(row.get('createdAt')), policy);
    attrs.response_due_at = due.responseDueAt || null;
    attrs.resolution_due_at = due.resolutionDueAt || null;
  }

  await row.update(attrs as never);
  const fresh = await db.SupportTicket.findByPk(ticketId, { include: ticketIncludes });
  const plain = (fresh as Model).get({ plain: true }) as Record<string, unknown>;
  return toView(plain, await slaFor(plain), false);
}
