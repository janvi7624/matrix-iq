import { NextRequest, NextResponse } from 'next/server';
import { getTmsViewer, isAccountsManager } from '@/lib/tmsAccess';
import { tmsBomRequestStore } from '@/lib/tmsBomRequestStore';
import { apiErrorResponse } from '@/lib/apiError';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { notifyUsers } from '@/lib/notificationStore';

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

// finance_approved -> payment_done. Gated to whoever manages the "Accounts"
// department (Department.managerIds, via lib/tmsAccess.ts's
// isAccountsManager) — a payment-proof attachment is required, kept in its
// own payment_proof_attachments field, separate from the general
// attachments array.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getTmsViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await isAccountsManager(viewer))) {
    return NextResponse.json({ error: 'Forbidden — only Accounts can mark this request paid' }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const proofUrls = toStringArray(body?.proofUrls);
  if (!proofUrls.length) {
    return NextResponse.json({ error: 'A payment proof attachment is required' }, { status: 400 });
  }

  try {
    const existing = await tmsBomRequestStore.findById(id);
    if (!existing) return NextResponse.json({ error: 'BOM request not found' }, { status: 404 });
    if (existing.status !== 'finance_approved') {
      return NextResponse.json({ error: 'This request is not awaiting payment' }, { status: 400 });
    }

    const updated = await tmsBomRequestStore.markPaymentDone(id, viewer.username, proofUrls);

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'tms_bom_request',
      entityId: id,
      action: 'BOM request payment marked done',
      previousStatus: 'finance_approved',
      newStatus: 'payment_done',
      remarks: existing.item_name,
      ip: getClientIp(request)
    });

    if (existing.created_by && existing.created_by !== viewer.username) {
      await notifyUsers([existing.created_by], {
        title: 'Payment done — collect your material',
        body: `Payment for "${existing.item_name}" (${existing.project_name}) is complete. Mark it received once the material is in hand.`,
        type: 'tms_bom_request_payment_done',
        entityType: 'tms_bom_request',
        entityId: id
      });
    }

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
