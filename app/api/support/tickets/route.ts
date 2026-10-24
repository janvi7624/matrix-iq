import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { canWorkSupportQueue, listAssignableEngineers } from '@/lib/supportTicketAccess';
import { createTicket, listInternalTickets, SupportTicketError } from '@/lib/supportTicketStore';
import { apiErrorResponse } from '@/lib/apiError';

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canWorkSupportQueue({ ...viewer, partnerId: viewer.partnerId })) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  try {
    const [tickets, engineers] = await Promise.all([
      listInternalTickets({ queue: searchParams.get('queue') || 'open', assigneeId: searchParams.get('assigneeId') || undefined }, viewer.userId),
      listAssignableEngineers()
    ]);
    return NextResponse.json({ tickets, engineers });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

// Internal staff raising a ticket (a site engineer reporting a failure).
// partnerId is null — see the nullable column on support_tickets.
export async function POST(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  try {
    const result = await createTicket(
      {
        title: str(body.title),
        description: str(body.description),
        category: str(body.category),
        issueType: str(body.issueType),
        product: str(body.product),
        modelSerial: str(body.modelSerial),
        customerName: str(body.customerName),
        location: str(body.location),
        priority: str(body.priority),
        occurredOn: str(body.occurredOn),
        projectId: str(body.projectId),
        contactPerson: str(body.contactPerson),
        contactMethod: str(body.contactMethod),
        attachments: Array.isArray(body.attachments) ? body.attachments.filter((a: unknown): a is string => typeof a === 'string') : []
      },
      viewer.userId,
      null
    );
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof SupportTicketError) return NextResponse.json({ error: error.message }, { status: 400 });
    return apiErrorResponse(error);
  }
}
