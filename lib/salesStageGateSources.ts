// Where the stage gates get their evidence.
//
// lib/salesStageRules.ts is pure and knows only "these field names must not be
// blank". This file is the impure half: it reads the LINKED records that
// already hold some of that information, so nobody is asked to retype a figure
// the application is already storing.
//
// The two gates that touch linked data, and why they are handled differently:
//
//   Quotation -> quotations      Project hasMany Quotation, with revisions
//                                (original_quotation_id + revision_number).
//                                Read-only here: a quotations row is a whole
//                                document — line items, totals, a unique
//                                number — so the gate AUTO-FILLS the project's
//                                quote_value / quotation_date from the newest
//                                one and lets them be typed in otherwise. Only
//                                19 of 185 projects have a quotation record at
//                                all; 7 of the 10 currently in the Quotation
//                                stage do not, because the quote went out by
//                                email. A gate that demanded one would block
//                                the normal path.
//
//   Won       -> purchase_orders Project hasMany PurchaseOrder, and the table
//                                already has po_number, po_date and amount.
//                                So PO details are NOT duplicated onto
//                                projects: the gate reads an existing PO if
//                                there is one, and otherwise CREATES the row
//                                from the transition. A PO row is four fields
//                                and cheap to write, which is why this half is
//                                read-write where the quotation half is not.

import { Op } from 'sequelize';
import { db, isUuid } from './db';
import { stageGateFailures, type GateFailure } from './salesStageRules';
import type { ProjectStage } from './types';

export interface LinkedQuotationSummary {
  id: string;
  quotation_number: string;
  total: number | null;
  /** The date the quote is dated by, as an IST calendar date. */
  date: string;
}

function dateOnly(value: unknown): string {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function decimal(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * The quotation that best represents "the quote we sent", or null.
 *
 * Ordering is deliberate rather than just "newest row":
 *
 *  1. approved before sent before draft — an approved quote is the one the
 *     customer actually holds, and a later draft revision does not undo that.
 *  2. then the highest revision_number — revisions are separate rows pointing
 *     at a root via original_quotation_id, so "latest" means the highest
 *     revision, not merely the most recently inserted.
 *  3. then newest created_at, to break ties.
 *
 * `date` prefers status_changed_at, which this app stamps when a quotation is
 * approved or rejected, and falls back to created_at. Note that
 * status_changed_at is NOT set when a quotation is merely marked 'sent' (see
 * lib/quotationStore.ts), so for a sent-but-unapproved quote the creation date
 * is the only date available — which is the date it was prepared, and the
 * closest honest answer to "quotation date" that the schema holds.
 */
export async function latestQuotationForProject(projectId: string): Promise<LinkedQuotationSummary | null> {
  if (!isUuid(projectId)) return null;

  const rows = await db.Quotation.findAll({
    where: { project_id: projectId } as never,
    attributes: ['id', 'quotation_number', 'total', 'status', 'status_changed_at', 'revision_number', 'created_at'],
    order: [
      ['revision_number', 'DESC'],
      ['created_at', 'DESC']
    ]
  });
  if (!rows.length) return null;

  const plain = rows.map((row) => row.get({ plain: true }) as Record<string, unknown>);
  const rank = (status: unknown): number => (status === 'approved' ? 0 : status === 'sent' ? 1 : 2);
  plain.sort((a, b) => rank(a.status) - rank(b.status));

  const best = plain[0];
  return {
    id: String(best.id),
    quotation_number: String(best.quotation_number ?? ''),
    total: decimal(best.total),
    date: dateOnly(best.status_changed_at) || dateOnly(best.created_at)
  };
}

export interface LinkedPurchaseOrderSummary {
  id: string;
  po_number: string;
  po_date: string;
  amount: number | null;
}

/** The newest purchase order linked to this project, or null. */
export async function latestPurchaseOrderForProject(projectId: string): Promise<LinkedPurchaseOrderSummary | null> {
  if (!isUuid(projectId)) return null;

  const row = await db.PurchaseOrder.findOne({
    where: { project_id: projectId } as never,
    order: [
      ['po_date', 'DESC'],
      ['created_at', 'DESC']
    ]
  });
  if (!row) return null;

  const plain = row.get({ plain: true }) as Record<string, unknown>;
  return {
    id: String(plain.id),
    po_number: String(plain.po_number ?? ''),
    po_date: dateOnly(plain.po_date),
    amount: decimal(plain.amount)
  };
}

/** Which projects out of a set already have a linked PO — one query, for the dashboard. */
export async function projectsWithPurchaseOrders(projectIds: string[]): Promise<Set<string>> {
  const ids = projectIds.filter(isUuid);
  if (!ids.length) return new Set();
  const rows = await db.PurchaseOrder.findAll({
    where: { project_id: { [Op.in]: ids } } as never,
    attributes: ['project_id'],
    group: ['project_id']
  });
  return new Set(rows.map((row) => String((row.get({ plain: true }) as Record<string, unknown>).project_id)));
}

export interface PurchaseOrderInput {
  po_number: string;
  po_value: unknown;
  po_date: string;
}

/**
 * Records the PO that won the deal, if the project has none yet.
 *
 * Returns the row it created, or null when one already existed — which is the
 * idempotent case that matters, because marking a project won twice must not
 * produce two purchase orders for one deal.
 *
 * Deliberately NOT inside the project's update transaction: a PO is a separate
 * business record, and a failure to write it must not silently roll back a
 * legitimate win. The caller checks the result and reports.
 */
export async function recordWinningPurchaseOrder(
  projectId: string,
  actorUserId: string | null,
  input: PurchaseOrderInput
): Promise<LinkedPurchaseOrderSummary | null> {
  if (!isUuid(projectId)) return null;

  const existing = await latestPurchaseOrderForProject(projectId);
  if (existing) return null;

  const amount = decimal(input.po_value);
  const row = await db.PurchaseOrder.create({
    project_id: projectId,
    created_by: actorUserId,
    po_number: input.po_number.trim(),
    po_date: input.po_date || null,
    amount: amount === null ? 0 : amount
  } as never);

  const plain = row.get({ plain: true }) as Record<string, unknown>;
  return {
    id: String(plain.id),
    po_number: String(plain.po_number ?? ''),
    po_date: dateOnly(plain.po_date),
    amount: decimal(plain.amount)
  };
}

export interface WonGateResult {
  failures: GateFailure[];
  /**
   * The PO to write once the save succeeds, or null when the project already
   * had one (so marking a deal won twice cannot produce two POs for one deal).
   */
  winningPo: PurchaseOrderInput | null;
}

/**
 * THE one answer to "may this project close as Won".
 *
 * Every route that closes a deal as won must come through here. It used to
 * live inline in PATCH /api/projects/[id], which meant the two OTHER routes
 * that flip status to 'won' — POST /api/po and PATCH /api/installation/[id],
 * both of which call projectStore.update({ status: 'won' }) directly — never
 * applied the gate at all. The result, measured on 2026-10-28: 14 of 16 won
 * projects had no Project Brief and 9 had no Project Name, because receiving
 * a PO closes the deal for you and never shows the Won checklist that asks
 * for them. STATUS_GATES.won existed the whole time; nothing was consulting
 * it on the path people actually use.
 *
 * `values` is the project AS IT WOULD BE after the change — merge any patch
 * over the existing row before calling, so a transition that supplies the
 * missing field in the same request passes rather than demanding two round
 * trips.
 *
 * `candidatePo` is for the caller that carries PO details ON the transition
 * (the Close-as-Won dialog). Callers acting AFTER a PO row already exists —
 * the PO route — pass null and are satisfied by the linked row below.
 */
export async function evaluateWonGate(
  projectId: string,
  nextStage: ProjectStage,
  values: Record<string, unknown>,
  candidatePo: PurchaseOrderInput | null = null
): Promise<WonGateResult> {
  const merged: Record<string, unknown> = { ...values };
  let winningPo: PurchaseOrderInput | null = null;

  // The PO lives in purchase_orders, never on the project — an existing
  // linked PO satisfies the gate; otherwise the transition has to carry it.
  const linked = await latestPurchaseOrderForProject(projectId);
  if (linked) {
    merged.po_number = linked.po_number;
    merged.po_value = linked.amount;
    merged.po_date = linked.po_date;
  } else if (candidatePo) {
    winningPo = candidatePo;
    merged.po_number = candidatePo.po_number;
    merged.po_value = candidatePo.po_value;
    merged.po_date = candidatePo.po_date;
  }

  const failures = stageGateFailures(nextStage, 'won', merged);

  // Existence, not blankness — stageGateFailures judges fields ON the project
  // row, and a quotation is a separate row, so it cannot be one of
  // STATUS_GATES' entries the way project_name/company/project_brief are. A
  // project that reached Won without ever generating a quotation has nothing
  // for Accounts/Billing to reconcile the PO against.
  if (!(await latestQuotationForProject(projectId))) {
    failures.push({
      field: 'quotation',
      label: 'Quotation',
      message: 'At least one quotation must be created for this project before it can be closed as Won.'
    });
  }

  return { failures, winningPo };
}
