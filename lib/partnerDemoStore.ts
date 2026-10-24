import { db, isUuid, sequelize } from './db';
import { findPartnerById } from './partnerStore';
import {
  PARTNER_DEMO_STATUS_LABEL,
  PartnerDemoStatus,
  partnerCanCancelDemo,
  resolvePartnerDemoStatus
} from './partnerDemoStatus';
import { DEMO_STATUS_LABEL, demoStageIndex } from './demoStages';
import type { DemoRequestStatus } from './types';

// Partner-requested product demonstrations.
//
// A partner request is a real demo_schedule row from the start (see the
// 20261020095000 migration), so the existing technical-approval ->
// manager-approval -> back-office chain runs over it unchanged. This module
// only covers the partner's side: raising a request, seeing a coarse derived
// status, and withdrawing one that has not yet committed materials.

export class PartnerDemoError extends Error {}

export interface PartnerDemoRequestInput {
  // Mirrors the internal "Request a demo" form (components/DemoScheduleView.tsx)
  // field for field, minus the three INTERNAL-STAFFING pickers: assigned
  // technical person, technical team members attending, and assigned rep.
  // Those are the sales person's call — see the PATCH guard in
  // app/api/demo-schedule/[id]/route.ts.
  projectId?: string;
  quotationId?: string;
  company: string;
  clientName: string;
  mode: 'onsite' | 'virtual';
  location: string;
  /** The internal form's "Demo date & time". */
  preferredDate: string;
  priority?: string;
  productDomains: string[];
  productsRequired: { product: string; quantity: number }[];
  demoObjective?: string;
  requirements: string;
  attachments: string[];
}

const DEMO_PRIORITIES = ['low', 'medium', 'high'];

export interface PartnerDemoView {
  id: string;
  company: string;
  client_name: string;
  mode: string;
  location: string;
  /** The coarse derived grouping — still used for the summary chip. */
  status: PartnerDemoStatus;
  status_label: string;
  // The INTERNAL status and its position in the approval chain, so the
  // portal can render the same pipeline the sales team sees. Shared rather
  // than collapsed on request: a partner coordinating a customer demo needs
  // to know whether materials have been dispatched, not just "approved".
  internal_status: string;
  internal_status_label: string;
  stage_index: number;
  assigned_technical_person: string;
  requested_date: string;
  scheduled_at: string;
  requirements: string;
  partner_remark: string;
  can_cancel: boolean;
  project_id: string;
  created_at: string;
}

function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

function toView(plain: Record<string, unknown>): PartnerDemoView {
  const internalStatus = (plain.status as string) ?? '';
  const scheduledAt = isoOrEmpty(plain.scheduled_at);
  const status = resolvePartnerDemoStatus({ status: internalStatus, scheduled_at: scheduledAt });
  const mode = (plain.mode as string) ?? 'onsite';
  return {
    id: plain.id as string,
    company: (plain.company as string) ?? '',
    client_name: (plain.client_name as string) ?? '',
    mode,
    location: (plain.location as string) ?? '',
    status,
    status_label: PARTNER_DEMO_STATUS_LABEL[status],
    internal_status: internalStatus,
    // 'Draft' is the internal word for "not yet submitted for approval" —
    // true of our pipeline, but meaningless to a partner who HAS submitted.
    // From their side it is with their sales contact, which is exactly what
    // is happening while it waits to be sent for technical approval.
    internal_status_label:
      internalStatus === 'draft'
        ? 'Submitted — with your sales contact'
        : DEMO_STATUS_LABEL[internalStatus as DemoRequestStatus] ?? internalStatus,
    stage_index: demoStageIndex(internalStatus as DemoRequestStatus, mode),
    // A NAME only — never the user id. Who is performing the demo is
    // something the partner legitimately needs for coordination.
    assigned_technical_person: (plain.assigned_technical_person as string) ?? '',
    requested_date: isoOrEmpty(plain.partner_requested_date),
    // The agreed date is shown ONLY once it is actually agreed — surfacing a
    // provisional internal date would have the partner tell their customer a
    // time nobody has committed to.
    scheduled_at: status === 'scheduled' || status === 'completed' ? scheduledAt : '',
    requirements: (plain.partner_requirements as string) ?? '',
    // partner_remark, never `notes` — see the migration comment.
    partner_remark: (plain.partner_remark as string) ?? '',
    can_cancel: partnerCanCancelDemo(internalStatus),
    project_id: (plain.project_id as string) ?? '',
    // plain.createdAt, not plain.created_at: underscored:true changes the
    // COLUMN name, not the attribute. Reading the column name gives undefined.
    created_at: isoOrEmpty(plain.createdAt)
  };
}

/**
 * Raise a demo request on a partner's behalf.
 *
 * created_by is the partner's relationship manager, for exactly the reason
 * documented in lib/partnerProjectStore.ts: it is the visibility key
 * lib/demoScheduleStore.ts scopes on, and an external account in that field
 * would put a partner inside the internal visibility graph. The requesting
 * portal user is recorded separately in requested_by_partner_user_id.
 *
 * Status starts at 'draft', the same place an internally-raised request
 * starts, so the existing approval chain picks it up with no special casing.
 */
export async function requestPartnerDemo(
  partnerId: string,
  input: PartnerDemoRequestInput,
  requestedByUserId: string
): Promise<{ id: string; ownerUserId: string | null }> {
  if (!isUuid(partnerId)) throw new PartnerDemoError('Unknown partner');
  const partner = await findPartnerById(partnerId);
  if (!partner) throw new PartnerDemoError('Unknown partner');
  if (!input.company.trim() && !input.clientName.trim()) {
    throw new PartnerDemoError('Customer name or company is required');
  }
  // Either a catalogue product or a written description — some domains
  // (System Integration) have no fixed catalogue, which is exactly why the
  // internal form tells you to describe it in Notes instead.
  if (!input.productsRequired.length && !input.requirements.trim()) {
    throw new PartnerDemoError('Pick the products to demonstrate, or describe what is needed');
  }
  if (!input.preferredDate) {
    throw new PartnerDemoError('Give a demo date and time');
  }

  // A demo may be tied to one of the partner's own projects — but only one
  // of theirs. Checked with partner_id in the WHERE so another partner's
  // project id cannot be attached to this request.
  // A quotation may be attached only if it has actually been SHARED with
  // this partner. Resolved through the share table, so a quotation they
  // merely know the id of — or another partner's — cannot be linked.
  let quotationId: string | null = null;
  if (input.quotationId && isUuid(input.quotationId)) {
    const share = await db.PartnerQuotationShare.findOne({
      where: { quotation_id: input.quotationId, partner_id: partnerId, revoked_at: null } as never,
      attributes: ['id']
    });
    if (!share) throw new PartnerDemoError('That quotation could not be found');
    quotationId = input.quotationId;
  }

  let projectId: string | null = null;
  if (input.projectId) {
    const project = await db.Project.findOne({
      where: { id: input.projectId, partner_id: partnerId } as never,
      attributes: ['id']
    });
    if (!project) throw new PartnerDemoError('That project could not be found');
    projectId = project.get('id') as string;
  }

  // Who owns this request.
  //
  // The relationship manager is the fallback, but when the demo is tied to
  // one of the partner's projects the ASSIGNED SALES PERSON on that project
  // is the right owner: they are running the deal, and they are the one who
  // picks the technical person. created_by is also the visibility key
  // lib/demoScheduleStore.ts scopes on, so this is what decides whose Demo
  // Schedule list it appears in and who sees the Submit/Assign controls.
  let ownerUserId: string | null = partner.relationship_manager_id || null;
  if (projectId) {
    const project = await db.Project.findByPk(projectId, { attributes: ['created_by', 'sales_person'] });
    const projectOwnerId = project?.get('created_by') as string | null | undefined;
    if (projectOwnerId) ownerUserId = projectOwnerId;
  }

  const requestedAt = input.preferredDate ? new Date(input.preferredDate) : null;

  return sequelize.transaction(async (t) => {
    const row = await db.DemoSchedule.create(
      {
        created_by: ownerUserId,
        requested_by_partner_user_id: requestedByUserId,
        partner_id: partnerId,
        project_id: projectId,
        quotation_id: quotationId,
        company: input.company.trim(),
        client_name: input.clientName.trim(),
        mode: input.mode === 'virtual' ? 'virtual' : 'onsite',
        location: input.location.trim(),
        product_domains: input.productDomains,
        priority: DEMO_PRIORITIES.includes(input.priority ?? '') ? input.priority : 'medium',
        demo_objective: input.demoObjective?.trim() || '',
        // scheduled_at carries the proposed time, exactly as the internal
        // form sets it at creation — so the request shows up in the internal
        // Demo Schedule list's Scheduled column like any other. It stays
        // provisional until the approval chain passes, and
        // partner_requested_date preserves the ORIGINAL ask so a later
        // change by our team is visible rather than silently overwriting it.
        scheduled_at: requestedAt,
        partner_requested_date: requestedAt,
        // The partner's own notes. Deliberately NOT `notes`, which is where
        // the sales team writes internal coordination once this is theirs.
        partner_requirements: input.requirements.trim(),
        attachments: input.attachments,
        status: 'draft',
        // products_demonstrated stays empty until the technical team records
        // what was actually shown — a different fact from what was asked for.
        products_demonstrated: [],
        // Empty: staffing is assigned by the sales person, never requested.
        technical_members: [],
        technical_approval: {},
        manager_approval: {}
      } as never,
      { transaction: t }
    );

    const id = row.get('id') as string;
    if (input.productsRequired.length) {
      await db.DemoProductLine.bulkCreate(
        input.productsRequired.map((p) => ({
          demo_schedule_id: id,
          product: p.product,
          quantity: Math.max(1, Math.floor(Number(p.quantity) || 1))
        })) as never,
        { transaction: t }
      );
    }
    return { id, ownerUserId };
  });
}

export async function listPartnerDemos(partnerId: string): Promise<PartnerDemoView[]> {
  if (!isUuid(partnerId)) return [];
  const rows = await db.DemoSchedule.findAll({
    where: { partner_id: partnerId } as never,
    order: [['created_at', 'DESC']]
  });
  return rows.map((r) => toView(r.get({ plain: true }) as Record<string, unknown>));
}

export async function findPartnerDemo(partnerId: string, demoId: string): Promise<PartnerDemoView | undefined> {
  if (!isUuid(partnerId) || !isUuid(demoId)) return undefined;
  const row = await db.DemoSchedule.findOne({ where: { id: demoId, partner_id: partnerId } as never });
  return row ? toView(row.get({ plain: true }) as Record<string, unknown>) : undefined;
}

/**
 * The partner withdrawing their own request.
 *
 * Allowed only before materials are committed — once a delivery challan
 * exists, cancelling is a conversation with the sales person, not a button.
 * Re-checked here and not merely hidden in the UI.
 */
export async function cancelPartnerDemo(partnerId: string, demoId: string): Promise<boolean> {
  if (!isUuid(partnerId) || !isUuid(demoId)) return false;
  const row = await db.DemoSchedule.findOne({ where: { id: demoId, partner_id: partnerId } as never });
  if (!row) return false;

  const internalStatus = (row.get('status') as string) ?? '';
  if (!partnerCanCancelDemo(internalStatus)) {
    throw new PartnerDemoError('This demo is already being prepared — please speak to your contact to change it.');
  }
  await row.update({ status: 'cancelled', partner_remark: 'Withdrawn by partner' } as never);
  return true;
}
