import { NextRequest, NextResponse } from 'next/server';
import { getPartnerViewer } from '@/lib/partnerContext';
import { addComment, findPartnerTicket, SupportTicketError, transitionTicket } from '@/lib/supportTicketStore';
import { isSupportTicketStatus } from '@/lib/supportTicketWorkflow';
import { apiErrorResponse } from '@/lib/apiError';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getPartnerViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id } = await params;
    // Scoped by partner_id in the query; internal comments are excluded by a
    // WHERE, not filtered after the fetch.
    const found = await findPartnerTicket(viewer.partnerId, id);
    if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(found);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

// A partner replying. is_internal is FORCED false — never read from the body,
// so a crafted request cannot plant a note in the internal channel.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getPartnerViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  try {
    const { id } = await params;
    // Ownership first: resolving through the partner-scoped finder means an
    // id belonging to someone else 404s before anything is written.
    const found = await findPartnerTicket(viewer.partnerId, id);
    if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    await addComment(id, viewer.userId, typeof body?.body === 'string' ? body.body : '', false,
      Array.isArray(body?.attachments) ? body.attachments.filter((a: unknown): a is string => typeof a === 'string') : []);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    if (error instanceof SupportTicketError) return NextResponse.json({ error: error.message }, { status: 400 });
    return apiErrorResponse(error);
  }
}

// Confirming a resolution, reopening, or replying to an information request.
// The workflow table decides what 'partner' may actually do.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getPartnerViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const status = typeof body?.status === 'string' ? body.status : '';
  if (!isSupportTicketStatus(status)) return NextResponse.json({ error: 'Unknown status' }, { status: 400 });

  try {
    const { id } = await params;
    const found = await findPartnerTicket(viewer.partnerId, id);
    if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const updated = await transitionTicket({
      ticketId: id,
      to: status,
      actor: 'partner',
      byUserId: viewer.userId,
      reason: typeof body?.reason === 'string' ? body.reason : ''
    });
    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof SupportTicketError) return NextResponse.json({ error: error.message }, { status: 409 });
    return apiErrorResponse(error);
  }
}
