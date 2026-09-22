import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { isAccountsPaymentActor } from '@/lib/accountsPaymentAccess';
import { holdPayment, parsePaymentId, resolveRequesterUsernames, resolveEntityIds, findPaymentItem } from '@/lib/accountsPaymentStore';
import { findUserByUsername } from '@/lib/userStore';
import { notifyUsers } from '@/lib/notificationStore';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { AuditLogEntry, PaymentSource } from '@/lib/types';

const AUDIT_ENTITY_TYPE: Record<PaymentSource, AuditLogEntry['entity_type']> = {
  reimbursement_sheet: 'reimbursement_sheet',
  admin_expense: 'reimbursement',
  office_expense: 'office_operation_expense',
  bom_request: 'tms_bom_request',
  travel_schedule: 'travel_schedule'
};

// Distinct from AUDIT_ENTITY_TYPE: notifications resolve their link via
// lib/notificationResolver.ts's RESOLVERS map, keyed by these exact strings
// — admin_expense's entityId is a batch id (Reimbursement.admin_note), not
// a row's UUID primary key, so it needs its own resolver key (batch
// lookup), separate from the generic 'reimbursement' audit-log type.
// office_expense_sheet (not office_operation_expense): these go to the HR/
// Admin staff who logged the entries, so they must link into their own
// module — office_operation_expense's link is the Accounts queue, which
// those staff can't open.
const NOTIFY_ENTITY_TYPE: Record<PaymentSource, string> = {
  reimbursement_sheet: 'reimbursement_sheet',
  admin_expense: 'admin_expense',
  office_expense: 'office_expense_sheet',
  bom_request: 'tms_bom_request',
  travel_schedule: 'travel_schedule'
};

export async function POST(request: NextRequest, { params }: { params: Promise<{ paymentId: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await isAccountsPaymentActor(viewer))) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });

  const { paymentId } = await params;
  const parsed = parsePaymentId(paymentId);
  if (!parsed) return NextResponse.json({ error: 'Invalid payment id' }, { status: 400 });

  const body = await request.json().catch(() => null);
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (!reason) return NextResponse.json({ error: 'A reason is required to put a payment on hold' }, { status: 400 });

  try {
    const actor = await findUserByUsername(viewer.username);
    if (!actor) return NextResponse.json({ error: 'Actor not found' }, { status: 404 });

    const entityIds = await resolveEntityIds(parsed.source, parsed.sourceId);

    const result = await holdPayment(parsed.source, parsed.sourceId, actor.id, reason);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

    const isGrouped = !(entityIds.length === 1 && entityIds[0] === parsed.sourceId);
    await Promise.all(entityIds.map((entityId) => logAudit({
      by: viewer.username, role: viewer.role, entityType: AUDIT_ENTITY_TYPE[parsed.source], entityId,
      action: 'payment_hold', previousStatus: 'payment_required', newStatus: 'on_hold',
      remarks: isGrouped ? `${reason} — part of ${paymentId}` : reason,
      ip: getClientIp(request)
    })));

    const requesterUsernames = await resolveRequesterUsernames(parsed.source, parsed.sourceId);
    if (requesterUsernames.length && entityIds.length) {
      await notifyUsers(requesterUsernames, {
        title: 'Payment put on hold',
        body: `Your ${parsed.source.replace('_', ' ')} payment has been put on hold: ${reason}`,
        type: 'payment_hold',
        entityType: NOTIFY_ENTITY_TYPE[parsed.source],
        entityId: entityIds[0]
      });
    }

    const updated = await findPaymentItem(paymentId);
    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
