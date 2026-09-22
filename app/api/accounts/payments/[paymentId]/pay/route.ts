import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { isAccountsPaymentActor } from '@/lib/accountsPaymentAccess';
import { findPaymentItem, payItem, parsePaymentId, resolveEntityIds } from '@/lib/accountsPaymentStore';
import { findUserByUsername } from '@/lib/userStore';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { AuditLogEntry, PaymentSource } from '@/lib/types';

// Maps each source to the entity_type its OWN existing audit trail already
// uses (reimbursement_sheet/tms_bom_request/travel_schedule pre-date this
// feature; office_operation_expense is the one new literal added for it) —
// keeps the audit log queryable per-source the same way it already is
// everywhere else, rather than inventing a separate generic "payment" type.
const AUDIT_ENTITY_TYPE: Record<PaymentSource, AuditLogEntry['entity_type']> = {
  reimbursement_sheet: 'reimbursement_sheet',
  admin_expense: 'reimbursement',
  office_expense: 'office_operation_expense',
  bom_request: 'tms_bom_request',
  travel_schedule: 'travel_schedule'
};

export async function POST(request: NextRequest, { params }: { params: Promise<{ paymentId: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await isAccountsPaymentActor(viewer))) return NextResponse.json({ error: 'Not authorized — only the Accounts team can process payments' }, { status: 403 });

  const { paymentId } = await params;
  const parsed = parsePaymentId(paymentId);
  if (!parsed) return NextResponse.json({ error: 'Invalid payment id' }, { status: 400 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const paymentMethod = typeof body.paymentMethod === 'string' ? body.paymentMethod.trim() : '';
  const paymentDate = typeof body.paymentDate === 'string' ? body.paymentDate : '';
  const paymentReference = typeof body.paymentReference === 'string' ? body.paymentReference.trim() : '';
  const remarks = typeof body.remarks === 'string' ? body.remarks.trim() : '';
  const proofUrls = Array.isArray(body.proofUrls) ? body.proofUrls.filter((v: unknown) => typeof v === 'string') : [];
  const expectedAmount = typeof body.expectedAmount === 'number' && Number.isFinite(body.expectedAmount) ? body.expectedAmount : undefined;

  if (!paymentMethod) return NextResponse.json({ error: 'Payment method is required' }, { status: 400 });

  try {
    const existing = await findPaymentItem(paymentId);
    if (!existing) return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
    if (existing.status === 'paid') return NextResponse.json({ error: 'This payment has already been completed' }, { status: 400 });
    if (existing.status === 'on_hold') return NextResponse.json({ error: 'This payment is on hold — resume it before paying' }, { status: 400 });
    if (!(existing.amount > 0)) return NextResponse.json({ error: 'Invalid payment amount' }, { status: 400 });

    const actor = await findUserByUsername(viewer.username);
    if (!actor) return NextResponse.json({ error: 'Actor not found' }, { status: 404 });

    // Resolved before paying — see resolveEntityIds for why the order matters.
    const entityIds = await resolveEntityIds(parsed.source, parsed.sourceId);

    const result = await payItem(parsed.source, parsed.sourceId, { id: actor.id, username: actor.username }, {
      paymentMethod, paymentDate, paymentReference, remarks, proofUrls, expectedAmount
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

    // One audit row per real record paid, so each Office entry / Admin
    // Expense row carries its own payment history, tagged with the sheet or
    // batch it was settled as part of.
    const baseRemarks = paymentReference ? `${paymentMethod} — Ref: ${paymentReference}` : paymentMethod;
    const isGrouped = !(entityIds.length === 1 && entityIds[0] === parsed.sourceId);
    await Promise.all(entityIds.map((entityId) => logAudit({
      by: viewer.username, role: viewer.role, entityType: AUDIT_ENTITY_TYPE[parsed.source], entityId,
      action: 'accounts_payment_done', previousStatus: existing.status, newStatus: 'paid',
      remarks: isGrouped ? `${baseRemarks} — part of ${paymentId}` : baseRemarks,
      ip: getClientIp(request)
    })));

    // An Office sheet's bare month key stops resolving once paid (its entries
    // move into a paid group), so this can legitimately be null here.
    const updated = await findPaymentItem(paymentId);
    return NextResponse.json(updated ?? { ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
