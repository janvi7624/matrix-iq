import { NextRequest, NextResponse } from 'next/server';
import { getPartnerViewer } from '@/lib/partnerContext';
import { createTicket, listPartnerTickets, SupportTicketError } from '@/lib/supportTicketStore';
import { findPartnerById } from '@/lib/partnerStore';
import { notifyUsers } from '@/lib/notificationStore';
import { apiErrorResponse } from '@/lib/apiError';
import { db } from '@/lib/db';

export async function GET(request: NextRequest) {
  const viewer = await getPartnerViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    return NextResponse.json(await listPartnerTickets(viewer.partnerId));
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
    // Fields read one by one — the body is never spread. A partner must not
    // be able to post status, assigned_to_id, or SLA timestamps. Note the
    // partnerId comes from the SESSION, not the request.
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
      viewer.partnerId
    );

    const partner = await findPartnerById(viewer.partnerId);
    if (partner?.relationship_manager_id) {
      const rm = await db.User.findByPk(partner.relationship_manager_id, { attributes: ['username'] });
      const username = rm?.get('username') as string | undefined;
      if (username) {
        void notifyUsers([username], {
          title: 'New partner support ticket',
          body: `${result.ticket_number} from ${partner.company_name}: ${str(body.title)}`,
          type: 'support_ticket_created',
          entityType: 'support_ticket',
          entityId: result.id
        });
      }
    }
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof SupportTicketError) return NextResponse.json({ error: error.message }, { status: 400 });
    return apiErrorResponse(error);
  }
}
