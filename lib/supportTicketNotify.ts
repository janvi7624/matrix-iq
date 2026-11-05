import { db } from './db';
import { notifyUsers } from './notificationStore';

// "A ticket has been routed to you." Shared by both creation routes
// (app/api/support/tickets and app/api/partner/support/tickets) so an
// internally-raised ticket and a partner-raised one reach the department
// manager the same way — the two routes otherwise notify quite different
// people and it would be easy for one to quietly drift.
//
// Never throws: a notification that fails must not fail the ticket somebody
// is trying to raise. The ticket row is already committed by the time this
// runs, and an unseen notification is recoverable (the ticket is in the
// manager's queue regardless); a 500 on submit is not.
export async function notifySupportAssignee(
  userId: string,
  ticketNumber: string,
  title: string,
  ticketId: string
): Promise<void> {
  try {
    const user = await db.User.findByPk(userId, { attributes: ['username'] });
    const username = user?.get('username') as string | undefined;
    if (!username) return;
    await notifyUsers([username], {
      title: 'Support ticket assigned to you',
      body: `${ticketNumber}: ${title || 'No title'} — assign an engineer`,
      type: 'support_ticket_created',
      entityType: 'support_ticket',
      entityId: ticketId
    });
  } catch {
    // Deliberately swallowed — see above.
  }
}
