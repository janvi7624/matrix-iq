import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import {
  findQuotationRequest,
  QuotationRequestError,
  respondToQuotationRequest
} from '@/lib/partnerQuotationRequestStore';
import { isQuotationRequestStatus, QuotationRequestStatus } from '@/lib/partnerQuotationRequestStages';
import { notifyUsers } from '@/lib/notificationStore';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { db } from '@/lib/db';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id } = await params;
    const found = await findQuotationRequest(id);
    if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(found);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

// Sales moving a request along: starting it, quoting it, or declining it.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const to = typeof body?.status === 'string' ? body.status : '';
  if (!isQuotationRequestStatus(to)) {
    return NextResponse.json({ error: 'Status must be open, in_progress, quoted or declined' }, { status: 400 });
  }

  try {
    const { id } = await params;

    // The transition rules, the decline-needs-a-reason rule and the
    // quotation-must-be-on-this-project rule all live in the store, so this
    // handler cannot be the weak point.
    const updated = await respondToQuotationRequest(id, {
      to: to as QuotationRequestStatus,
      note: typeof body?.note === 'string' ? body.note : undefined,
      quotationId: typeof body?.quotationId === 'string' ? body.quotationId : undefined,
      handledByUserId: viewer.userId
    });
    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Tell the partner's own portal users. Scoped by partnerId, so one
    // partner can never be told about another's request.
    const partnerUsers = await db.User.findAll({
      where: { partnerId: updated.partner_id, status: 'active' } as never,
      attributes: ['username']
    });
    const usernames = partnerUsers.map((u) => u.get('username') as string);
    if (usernames.length) {
      const headline =
        to === 'quoted'
          ? 'Your quotation is ready'
          : to === 'declined'
            ? 'We could not quote this'
            : 'We are preparing your quotation';
      void notifyUsers(usernames, {
        title: headline,
        body: `${updated.project_label}${updated.response_note ? ` — ${updated.response_note.slice(0, 120)}` : ''}`,
        type: 'partner_quotation_request_updated',
        entityType: 'partner_quotation_request',
        entityId: id
      });
    }

    void logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'partner_quotation_request',
      entityId: id,
      action: `Partner quotation request ${to}`,
      previousStatus: '',
      newStatus: to,
      remarks: updated.response_note || '',
      ip: getClientIp(request)
    });

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof QuotationRequestError) return NextResponse.json({ error: error.message }, { status: 409 });
    return apiErrorResponse(error);
  }
}
