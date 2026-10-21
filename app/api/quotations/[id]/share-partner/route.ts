import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { findQuotationById } from '@/lib/quotationStore';
import { canManageQuotation } from '@/lib/quotationAccess';
import {
  eligiblePartnerForQuotation,
  isShareableStatus,
  listSharesForQuotation,
  PartnerShareError,
  revokeQuotationShare,
  shareQuotationWithPartner
} from '@/lib/partnerQuotationStore';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { notifyUsers } from '@/lib/notificationStore';
import { db } from '@/lib/db';

// Publishing a quotation to a partner, and withdrawing it again.
//
// Authorization is canManageQuotation — the SAME rule that already governs
// changing a quotation's status or logging a follow-up. Sharing with the
// customer's channel partner is a commercial act by whoever owns the quote,
// so it belongs to the quotation's own write permission rather than to the
// partner-management permission: a Sales manager who does not own the deal
// has no business publishing its pricing.

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id } = await params;
    const quotation = await findQuotationById(id);
    if (!quotation) return NextResponse.json({ error: 'Quotation not found' }, { status: 404 });
    if (!(await canManageQuotation(viewer.username, quotation))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    // Returns both halves the UI needs in one call: who this MAY be shared
    // with (derived from the project, so the control can be hidden entirely
    // on a direct project) and who it IS shared with.
    const [shares, eligiblePartner] = await Promise.all([listSharesForQuotation(id), eligiblePartnerForQuotation(id)]);
    return NextResponse.json({
      shares,
      eligiblePartner,
      // 'draft' is never shareable — surfaced so the button can explain
      // itself rather than only failing on click.
      shareable: isShareableStatus(quotation.status)
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const partnerId = typeof body?.partnerId === 'string' ? body.partnerId : '';
  const note = typeof body?.note === 'string' ? body.note : '';
  if (!partnerId) return NextResponse.json({ error: 'partnerId is required' }, { status: 400 });

  try {
    const { id } = await params;
    const quotation = await findQuotationById(id);
    if (!quotation) return NextResponse.json({ error: 'Quotation not found' }, { status: 404 });
    if (!(await canManageQuotation(viewer.username, quotation))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await shareQuotationWithPartner(id, partnerId, viewer.userId, note);

    // Tell the partner's own portal users — scoped by partnerId, so no other
    // partner can be told about this quotation.
    const partnerUsers = await db.User.findAll({ where: { partnerId, status: 'active' } as never, attributes: ['username'] });
    const usernames = partnerUsers.map((u) => u.get('username') as string);
    if (usernames.length) {
      void notifyUsers(usernames, {
        title: 'A quotation has been shared with you',
        body: `${quotation.quotation_number} is now available in your portal.`,
        type: 'partner_quotation_shared',
        entityType: 'partner_quotation',
        entityId: id
      });
    }

    void logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'quotation',
      entityId: id,
      action: `Quotation ${quotation.quotation_number} shared with partner`,
      previousStatus: '',
      newStatus: 'shared',
      remarks: note,
      ip: getClientIp(request)
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof PartnerShareError) return NextResponse.json({ error: error.message }, { status: 400 });
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const partnerId = searchParams.get('partnerId') || '';
  if (!partnerId) return NextResponse.json({ error: 'partnerId is required' }, { status: 400 });

  try {
    const { id } = await params;
    const quotation = await findQuotationById(id);
    if (!quotation) return NextResponse.json({ error: 'Quotation not found' }, { status: 404 });
    if (!(await canManageQuotation(viewer.username, quotation))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const revoked = await revokeQuotationShare(id, partnerId, viewer.userId);
    if (!revoked) return NextResponse.json({ error: 'That quotation is not shared with this partner' }, { status: 404 });

    void logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'quotation',
      entityId: id,
      action: `Quotation ${quotation.quotation_number} withdrawn from partner`,
      previousStatus: 'shared',
      newStatus: 'revoked',
      ip: getClientIp(request)
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
