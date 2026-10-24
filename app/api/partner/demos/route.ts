import { NextRequest, NextResponse } from 'next/server';
import { getPartnerViewer } from '@/lib/partnerContext';
import { listPartnerDemos, PartnerDemoError, requestPartnerDemo } from '@/lib/partnerDemoStore';
import { findPartnerById } from '@/lib/partnerStore';
import { notifyUsers } from '@/lib/notificationStore';
import { apiErrorResponse } from '@/lib/apiError';
import { db } from '@/lib/db';

export async function GET(request: NextRequest) {
  const viewer = await getPartnerViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    return NextResponse.json(await listPartnerDemos(viewer.partnerId));
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
    // able to post status, assigned_technical_person_id, technical_members
    // or an approval object and have it stick. They request; we assign.
    const { id, ownerUserId } = await requestPartnerDemo(
      viewer.partnerId,
      {
        projectId: str(body.projectId),
        quotationId: str(body.quotationId),
        company: str(body.company),
        clientName: str(body.clientName),
        mode: body.mode === 'virtual' ? 'virtual' : 'onsite',
        location: str(body.location),
        preferredDate: str(body.preferredDate),
        priority: str(body.priority),
        productDomains: Array.isArray(body.productDomains)
          ? body.productDomains.filter((d: unknown): d is string => typeof d === 'string')
          : [],
        // Shape-checked item by item — a malformed line must not reach the
        // bulkCreate, and a partner must not be able to post a negative or
        // absurd quantity.
        productsRequired: Array.isArray(body.productsRequired)
          ? body.productsRequired
              .filter((p: unknown): p is { product: string; quantity: unknown } =>
                !!p && typeof (p as { product?: unknown }).product === 'string')
              .map((p: { product: string; quantity: unknown }) => ({
                product: p.product.trim(),
                quantity: Math.min(999, Math.max(1, Math.floor(Number(p.quantity) || 1)))
              }))
              .filter((p: { product: string }) => !!p.product)
          : [],
        demoObjective: str(body.demoObjective),
        requirements: str(body.requirements),
        attachments: Array.isArray(body.attachments) ? body.attachments.filter((a: unknown): a is string => typeof a === 'string') : []
      },
      viewer.userId
    );

    const partner = await findPartnerById(viewer.partnerId);
    // Notify whoever the request was actually attributed to — the project's
    // assigned sales person when it is tied to one, otherwise the
    // relationship manager. Re-deriving it here could pick a different
    // person from the one who can actually see and action the demo.
    if (ownerUserId) {
      const owner = await db.User.findByPk(ownerUserId, { attributes: ['username'] });
      const username = owner?.get('username') as string | undefined;
      if (username) {
        // Names the action, not just the event. The request arrives as a
        // DRAFT owned by this person — it does not enter the technical/
        // manager approval chain until they assign a technical person and
        // submit it, so a notification that only said "a demo was requested"
        // would leave them with nothing to do and the request stuck.
        void notifyUsers([username], {
          title: 'Partner demo request — needs your action',
          body: `${partner?.company_name ?? 'A partner'} requested a demo for ${str(body.clientName) || str(body.company)}. Assign a technical person and submit it for approval.`,
          type: 'partner_demo_requested',
          entityType: 'demo',
          entityId: id
        });
      }
    }

    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    if (error instanceof PartnerDemoError) return NextResponse.json({ error: error.message }, { status: 400 });
    return apiErrorResponse(error);
  }
}
