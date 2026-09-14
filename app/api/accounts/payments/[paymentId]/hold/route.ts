import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { isAccountsPaymentActor } from '@/lib/accountsPaymentAccess';
import { holdPayment, parsePaymentId, resolveRequesterUsername, findPaymentItem } from '@/lib/accountsPaymentStore';
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
const NOTIFY_ENTITY_TYPE: Record<PaymentSource, string> = {
  reimbursement_sheet: 'reimbursement_sheet',
  admin_expense: 'admin_expense',
  office_expense: 'office_operation_expense',
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

    const result = await holdPayment(parsed.source, parsed.sourceId, actor.id, reason);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

    await logAudit({
      by: viewer.username, role: viewer.role, entityType: AUDIT_ENTITY_TYPE[parsed.source], entityId: parsed.sourceId,
      action: 'payment_hold', previousStatus: 'payment_required', newStatus: 'on_hold', remarks: reason,
      ip: getClientIp(request)
    });

    const requesterUsername = await resolveRequesterUsername(parsed.source, parsed.sourceId);
    if (requesterUsername) {
      await notifyUsers([requesterUsername], {
        title: 'Payment put on hold',
        body: `Your ${parsed.source.replace('_', ' ')} payment has been put on hold: ${reason}`,
        type: 'payment_hold',
        entityType: NOTIFY_ENTITY_TYPE[parsed.source],
        entityId: parsed.sourceId
      });
    }

    const updated = await findPaymentItem(paymentId);
    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
