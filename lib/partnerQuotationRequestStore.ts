import { Model } from 'sequelize';
import { db, isUuid, sequelize } from './db';
import { PartnerShareError, shareQuotationWithPartner } from './partnerQuotationStore';
import { isShareableQuotationStatus } from './quotationStatus';
import {
  QuotationRequestStatus,
  QuotationRequestUrgency,
  canTransition,
  isQuotationRequestUrgency,
  requiresQuotation,
  requiresResponseNote
} from './partnerQuotationRequestStages';

// Partner quotation requests — the ask, not the quotation.
//
// Every read is scoped either by partner_id (the portal) or by the internal
// queue's own authorization (the sales side). Nothing here takes a partnerId
// from a request body; callers pass one resolved from getPartnerViewer().

export class QuotationRequestError extends Error {}

function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

/** What the PARTNER may read. An allow-list, like every other partner payload. */
export interface PartnerVisibleQuotationRequest {
  id: string;
  project_id: string;
  project_label: string;
  requirements: string;
  products: string;
  quantity_note: string;
  needed_by: string;
  urgency: string;
  status: QuotationRequestStatus;
  created_at: string;
  // Sales' reply — a decline reason, or a note alongside the quotation.
  response_note: string;
  // Present once quoted, so the portal can link straight to the document.
  // Only ever populated from a share the partner already has.
  quotation_id: string;
  quotation_number: string;
}

/** A quotation on the request's project, offered as the answer to it. */
export interface LinkableQuotation {
  id: string;
  quotation_number: string;
  status: string;
  /** False for a draft — shareable statuses only, see lib/quotationStatus.ts. */
  shareable: boolean;
  /**
   * Enough to tell two quotations on the same project apart without opening
   * them. A number and a status alone is not: revisions of one quotation
   * differ only in their suffix, and a project can carry several unrelated
   * quotes for different scopes.
   */
  total: number;
  created_at: string;
  revision_number: number;
  revision_reason: string;
  prepared_by: string;
  client_company: string;
  validity_days: number;
  /** 'sent' plus an elapsed validity window — the partner would open a dead quote. */
  expired: boolean;
  /** Already shared with THIS partner, so re-sending would be a no-op. */
  already_shared: boolean;
}

/** What the SALES side reads. Carries the partner's identity, which the partner payload does not. */
export interface InternalQuotationRequest extends PartnerVisibleQuotationRequest {
  partner_id: string;
  partner_company: string;
  partner_code: string;
  requested_by: string;
  sales_person: string;
  handled_by: string;
  handled_at: string;
  /**
   * The quotations already created on this project — what the "Which
   * quotation answers this?" picker offers.
   *
   * Carried on the row rather than fetched by the browser: there is no GET
   * on /api/quotations (it is POST-only), and the alternatives are either
   * own-quotations-only or admin-gated — so a quotation a colleague created
   * for this project would never have appeared. Resolving it here also means
   * the list is scoped by the same authorization that let this person see
   * the request at all.
   */
  project_quotations: LinkableQuotation[];
}

const INCLUDES = [
  { model: db.Partner, as: 'partner', attributes: ['id', 'company_name', 'partner_code'] },
  {
    model: db.Project,
    as: 'project',
    attributes: ['id', 'project_name', 'client_name', 'company', 'sales_person', 'partner_id']
  },
  { model: db.User, as: 'requester', attributes: ['id', 'username', 'name'] },
  { model: db.User, as: 'handler', attributes: ['id', 'username', 'name'] },
  { model: db.Quotation, as: 'quotation', attributes: ['id', 'quotation_number'], required: false }
];

function projectLabel(project: { project_name?: string; client_name?: string; company?: string } | null): string {
  if (!project) return '';
  return project.project_name || project.company || project.client_name || '';
}

function toPartnerView(row: Model): PartnerVisibleQuotationRequest {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const project = plain.project as { project_name?: string; client_name?: string; company?: string } | null;
  const quotation = plain.quotation as { id?: string; quotation_number?: string } | null;
  return {
    id: plain.id as string,
    project_id: (plain.project_id as string) ?? '',
    project_label: projectLabel(project),
    requirements: (plain.requirements as string) ?? '',
    products: (plain.products as string) ?? '',
    quantity_note: (plain.quantity_note as string) ?? '',
    needed_by: isoOrEmpty(plain.needed_by),
    urgency: (plain.urgency as string) ?? 'medium',
    status: (plain.status as QuotationRequestStatus) ?? 'open',
    // underscored:true renames the COLUMN, not the attribute — this is
    // createdAt, never created_at. Reading the wrong one yields undefined
    // and an "Invalid Date" in the portal.
    created_at: isoOrEmpty(plain.createdAt),
    response_note: (plain.response_note as string) ?? '',
    quotation_id: quotation?.id ?? '',
    quotation_number: quotation?.quotation_number ?? ''
  };
}

function toInternalView(row: Model): InternalQuotationRequest {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const partner = plain.partner as { id?: string; company_name?: string; partner_code?: string } | null;
  const project = plain.project as { sales_person?: string } | null;
  const requester = plain.requester as { username?: string; name?: string } | null;
  const handler = plain.handler as { username?: string; name?: string } | null;
  return {
    ...toPartnerView(row),
    partner_id: partner?.id ?? '',
    partner_company: partner?.company_name ?? '',
    partner_code: partner?.partner_code ?? '',
    requested_by: requester?.name || requester?.username || '',
    sales_person: project?.sales_person ?? '',
    handled_by: handler?.name || handler?.username || '',
    handled_at: isoOrEmpty(plain.handled_at),
    // Filled in by the caller, which loads them for every row in one query
    // rather than one query per request.
    project_quotations: []
  };
}

/**
 * The quotations on each of these projects, keyed by project id.
 *
 * One query for the whole page, not one per request — a queue of twenty
 * would otherwise be twenty round trips. Soft-deleted quotations are
 * excluded by the default paranoid scope, which is what we want: a deleted
 * quotation must not be linkable as the answer to anything.
 */
async function quotationsByProject(projectIds: string[], partnerId: string): Promise<Map<string, LinkableQuotation[]>> {
  const byProject = new Map<string, LinkableQuotation[]>();
  const ids = [...new Set(projectIds.filter(Boolean))];
  if (!ids.length) return byProject;

  const rows = await db.Quotation.findAll({
    where: { project_id: ids } as never,
    attributes: [
      'id', 'quotation_number', 'status', 'project_id', 'total', 'created_at',
      'revision_number', 'revision_reason', 'prepared_by', 'client_company', 'validity_days'
    ],
    order: [['created_at', 'DESC']]
  });

  // Which of these the partner can already see, so the picker can say so
  // rather than offering a re-send that does nothing.
  const sharedIds = new Set<string>();
  if (rows.length) {
    const shares = await db.PartnerQuotationShare.findAll({
      where: { quotation_id: rows.map((r) => r.get('id') as string), partner_id: partnerId, revoked_at: null } as never,
      attributes: ['quotation_id']
    });
    for (const share of shares) sharedIds.add(share.get('quotation_id') as string);
  }

  for (const row of rows) {
    const plain = row.get({ plain: true }) as Record<string, unknown>;
    const projectId = plain.project_id as string;
    const status = (plain.status as string) ?? '';
    // Both spellings, deliberately. underscored:true normally exposes the
    // attribute as `createdAt` — but naming 'created_at' in `attributes`
    // above makes Sequelize key it as `created_at` instead. Reading only one
    // left the date blank and `expired` permanently false.
    const createdAt = isoOrEmpty(plain.createdAt ?? plain.created_at);
    const validityDays = Number(plain.validity_days) || 0;
    const list = byProject.get(projectId) ?? [];
    list.push({
      id: plain.id as string,
      quotation_number: (plain.quotation_number as string) ?? '',
      status,
      shareable: isShareableQuotationStatus(status),
      total: Number(plain.total) || 0,
      created_at: createdAt,
      revision_number: Number(plain.revision_number) || 0,
      revision_reason: (plain.revision_reason as string) ?? '',
      prepared_by: (plain.prepared_by as string) ?? '',
      client_company: (plain.client_company as string) ?? '',
      validity_days: validityDays,
      // Mirrors computeEffectiveStatusClient's rule rather than importing it,
      // which would need the full record shape. Only 'sent' can lapse —
      // an approved quotation stays valid.
      expired:
        status === 'sent' &&
        validityDays > 0 &&
        Boolean(createdAt) &&
        Date.now() > new Date(createdAt).getTime() + validityDays * 24 * 60 * 60 * 1000,
      already_shared: sharedIds.has(plain.id as string)
    });
    byProject.set(projectId, list);
  }
  return byProject;
}

export interface CreateQuotationRequestInput {
  projectId: string;
  requirements: string;
  products?: string;
  quantityNote?: string;
  neededBy?: string;
  urgency?: string;
}

/**
 * A partner asking for a quotation.
 *
 * The project is re-checked against partner_id here rather than trusted from
 * the caller: project ids are guessable, and without this a partner could
 * attach their ask to another company's deal — which would then show that
 * deal's name back to them in their own list.
 */
export async function createQuotationRequest(
  partnerId: string,
  input: CreateQuotationRequestInput,
  requestedByUserId: string
): Promise<PartnerVisibleQuotationRequest> {
  if (!isUuid(partnerId)) throw new QuotationRequestError('Unknown partner');
  if (!isUuid(input.projectId)) throw new QuotationRequestError('Choose which project this quotation is for');
  if (!input.requirements?.trim()) throw new QuotationRequestError('Describe what you need quoted');

  const project = await db.Project.findOne({ where: { id: input.projectId, partner_id: partnerId } as never });
  if (!project) throw new QuotationRequestError('That project could not be found');

  const urgency: QuotationRequestUrgency = isQuotationRequestUrgency(input.urgency ?? '')
    ? (input.urgency as QuotationRequestUrgency)
    : 'medium';

  const row = await db.PartnerQuotationRequest.create({
    partner_id: partnerId,
    project_id: input.projectId,
    requested_by_user_id: requestedByUserId || null,
    requirements: input.requirements.trim(),
    products: input.products?.trim() || null,
    quantity_note: input.quantityNote?.trim() || null,
    needed_by: input.neededBy || null,
    urgency,
    status: 'open'
  } as never);

  const fresh = await db.PartnerQuotationRequest.findByPk(row.get('id') as string, { include: INCLUDES as never });
  return toPartnerView(fresh as Model);
}

/** This partner's requests, newest first. */
export async function listPartnerQuotationRequests(partnerId: string): Promise<PartnerVisibleQuotationRequest[]> {
  if (!isUuid(partnerId)) return [];
  const rows = await db.PartnerQuotationRequest.findAll({
    where: { partner_id: partnerId } as never,
    include: INCLUDES as never,
    order: [['created_at', 'DESC']]
  });
  return rows.map(toPartnerView);
}

/** One request, but only if it belongs to this partner. */
export async function findPartnerQuotationRequest(
  partnerId: string,
  id: string
): Promise<PartnerVisibleQuotationRequest | null> {
  if (!isUuid(partnerId) || !isUuid(id)) return null;
  const row = await db.PartnerQuotationRequest.findOne({
    where: { id, partner_id: partnerId } as never,
    include: INCLUDES as never
  });
  return row ? toPartnerView(row) : null;
}

/**
 * The internal queue.
 *
 * `salesPerson` narrows to one person's own requests. Passing undefined
 * returns every partner's — which is why the ROUTE decides, from the
 * viewer's permissions, rather than this function guessing.
 */
export async function listQuotationRequestsForSales(options?: {
  salesPerson?: string;
  openOnly?: boolean;
}): Promise<InternalQuotationRequest[]> {
  const where: Record<string, unknown> = {};
  if (options?.openOnly) where.status = ['open', 'in_progress'];

  const rows = await db.PartnerQuotationRequest.findAll({
    where: where as never,
    include: INCLUDES as never,
    order: [['created_at', 'DESC']]
  });

  const all = rows.map(toInternalView);
  // Shares are per-partner, so each row's list is resolved against its own
  // partner rather than one global pass.
  const byProject = new Map<string, LinkableQuotation[]>();
  for (const request of all) {
    if (byProject.has(request.project_id)) continue;
    const found = await quotationsByProject([request.project_id], request.partner_id);
    byProject.set(request.project_id, found.get(request.project_id) ?? []);
  }
  for (const request of all) request.project_quotations = byProject.get(request.project_id) ?? [];

  if (!options?.salesPerson) return all;
  // Filtered in memory rather than in SQL: the owner lives on the joined
  // project, and a WHERE across the include would drop requests whose
  // project has no owner yet — exactly the unassigned ones a manager most
  // needs to see.
  return all.filter((r) => r.sales_person === options.salesPerson);
}

export async function findQuotationRequest(id: string): Promise<InternalQuotationRequest | null> {
  if (!isUuid(id)) return null;
  const row = await db.PartnerQuotationRequest.findByPk(id, { include: INCLUDES as never });
  if (!row) return null;
  const view = toInternalView(row);
  view.project_quotations = (await quotationsByProject([view.project_id], view.partner_id)).get(view.project_id) ?? [];
  return view;
}

export interface RespondInput {
  to: QuotationRequestStatus;
  note?: string;
  quotationId?: string;
  handledByUserId: string;
}

/**
 * Sales moving a request along.
 *
 * Every rule the stages module states is enforced HERE, not in the route: a
 * rule that lives only in a handler is one new endpoint away from being
 * bypassed.
 */
export async function respondToQuotationRequest(id: string, input: RespondInput): Promise<InternalQuotationRequest | null> {
  if (!isUuid(id)) return null;
  const row = await db.PartnerQuotationRequest.findByPk(id);
  if (!row) return null;

  const from = row.get('status') as string;
  if (!canTransition(from, input.to)) {
    throw new QuotationRequestError(`A ${from} request cannot be moved to ${input.to}`);
  }
  if (requiresResponseNote(input.to) && !input.note?.trim()) {
    throw new QuotationRequestError('Say why this is not being quoted — the partner will see it');
  }

  let quotationId: string | null = null;
  if (requiresQuotation(input.to)) {
    if (!isUuid(input.quotationId ?? '')) {
      throw new QuotationRequestError('Pick the quotation that answers this request');
    }
    // The quotation must belong to the SAME project the request was raised
    // against. Without this check a mis-click could link a partner's request
    // to another customer's quotation, and the portal would then offer them
    // its number.
    const quotation = await db.Quotation.findOne({
      where: { id: input.quotationId, project_id: row.get('project_id') } as never
    });
    if (!quotation) throw new QuotationRequestError('That quotation is not on this project');
    quotationId = input.quotationId as string;

    // Answering the request IS sharing it. Selecting the quotation here used
    // to only record a link, leaving someone to go to Existing Quotations
    // and press Share separately — which meant the partner was told their
    // quotation was ready while they still could not open it.
    //
    // Done BEFORE the status update, deliberately: shareQuotationWithPartner
    // refuses a draft and re-checks that the project is this partner's, and
    // a refusal must leave the request exactly as it was rather than marking
    // it quoted with nothing shared.
    try {
      await shareQuotationWithPartner(
        quotationId,
        row.get('partner_id') as string,
        input.handledByUserId,
        input.note?.trim() ?? ''
      );
    } catch (error) {
      // Translated so the route's single catch surfaces the real reason —
      // "A draft quotation cannot be shared" is exactly what the person
      // needs to read, not a generic failure.
      if (error instanceof PartnerShareError) throw new QuotationRequestError(error.message);
      throw error;
    }
  }

  return sequelize.transaction(async (t) => {
    await row.update(
      {
        status: input.to,
        response_note: input.note?.trim() ?? row.get('response_note'),
        quotation_id: quotationId ?? row.get('quotation_id'),
        handled_by_user_id: input.handledByUserId || null,
        handled_at: new Date()
      } as never,
      { transaction: t }
    );
    const fresh = await db.PartnerQuotationRequest.findByPk(id, { include: INCLUDES as never, transaction: t });
    return toInternalView(fresh as Model);
  });
}

/** How many requests are still work. Drives the sidebar badge. */
export async function countOpenQuotationRequests(): Promise<number> {
  return db.PartnerQuotationRequest.count({ where: { status: ['open', 'in_progress'] } as never });
}
