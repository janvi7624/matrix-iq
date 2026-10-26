import { NextRequest, NextResponse } from 'next/server';
import { getPartnerViewer } from '@/lib/partnerContext';
import {
  createQuotationRequest,
  listPartnerQuotationRequests,
  QuotationRequestError
} from '@/lib/partnerQuotationRequestStore';
import { resolveQuotationRequestRecipient } from '@/lib/partnerQuotationRequestRouting';
import { notifyUsers } from '@/lib/notificationStore';
import { apiErrorResponse } from '@/lib/apiError';

export async function GET(request: NextRequest) {
  const viewer = await getPartnerViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    return NextResponse.json(await listPartnerQuotationRequests(viewer.partnerId));
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const viewer = await getPartnerViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

  try {
    // Read field by field — the body is never spread. A partner must not be
    // able to post status, quotation_id, handled_by or partner_id; the
    // partnerId comes from the SESSION.
    const created = await createQuotationRequest(
      viewer.partnerId,
      {
        projectId: str(body.projectId),
        requirements: str(body.requirements),
        products: str(body.products),
        quantityNote: str(body.quantityNote),
        neededBy: str(body.neededBy),
        urgency: str(body.urgency)
      },
      viewer.userId
    );

    // To whoever owns the project, falling back to the relationship manager
    // when nobody is assigned yet — otherwise a request against an
    // unassigned project would notify nobody and sit unseen.
    const recipient = await resolveQuotationRequestRecipient(created.project_id, viewer.partnerId);
    if (recipient) {
      void notifyUsers([recipient], {
        title: 'Partner requested a quotation',
        body: `${viewer.partner.company_name} — ${created.project_label}: ${created.requirements.slice(0, 120)}`,
        type: 'partner_quotation_requested',
        entityType: 'partner_quotation_request',
        entityId: created.id
      });
    }

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof QuotationRequestError) return NextResponse.json({ error: error.message }, { status: 400 });
    return apiErrorResponse(error);
  }
}
