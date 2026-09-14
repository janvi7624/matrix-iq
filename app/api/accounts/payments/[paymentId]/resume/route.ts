import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { isAccountsPaymentActor } from '@/lib/accountsPaymentAccess';
import { resumePayment, parsePaymentId, resolveRequesterUsername, findPaymentItem } from '@/lib/accountsPaymentStore';
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

// See the identical constant in ../hold/route.ts for why this is separate
// from AUDIT_ENTITY_TYPE.
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

  try {
    const actor = await findUserByUsername(viewer.username);
    if (!actor) return NextResponse.json({ error: 'Actor not found' }, { status: 404 });

    const result = await resumePayment(parsed.source, parsed.sourceId, actor.id);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

    await logAudit({
      by: viewer.username, role: viewer.role, entityType: AUDIT_ENTITY_TYPE[parsed.source], entityId: parsed.sourceId,
      action: 'payment_resume', previousStatus: 'on_hold', newStatus: 'payment_required', remarks: '',
      ip: getClientIp(request)
    });

    const requesterUsername = await resolveRequesterUsername(parsed.source, parsed.sourceId);
    if (requesterUsername) {
      await notifyUsers([requesterUsername], {
        title: 'Payment resumed',
        body: `Your ${parsed.source.replace('_', ' ')} payment hold has been lifted and is awaiting payment again.`,
        type: 'payment_resume',
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
