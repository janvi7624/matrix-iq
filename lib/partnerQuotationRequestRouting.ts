import { db } from './db';
import { findPartnerById } from './partnerStore';

// Who hears about a partner's quotation request.
//
// Extracted from the route so the partner side and the sales side resolve
// the same person. The rule is the one the demo request already uses: the
// project's own sales owner, because that is who the partner is already
// dealing with on that deal — not a central desk that would then have to
// forward it.
//
// The fallback matters more than it looks. A request raised against a
// project nobody has been assigned to yet would otherwise notify NOBODY and
// sit in a queue no one opens; the relationship manager is the one person
// guaranteed to exist for a partner.

/**
 * The username to notify, or '' when neither an owner nor a relationship
 * manager can be resolved.
 *
 * Returning '' rather than throwing is deliberate: a request must still be
 * recorded when there is nobody to tell. It appears in the internal queue
 * either way, and losing the partner's ask because our own assignment is
 * incomplete would be the worse failure.
 */
export async function resolveQuotationRequestRecipient(projectId: string, partnerId: string): Promise<string> {
  const project = await db.Project.findByPk(projectId, { attributes: ['sales_person', 'created_by'] });

  // sales_person is free text holding a username in nearly all rows, but
  // display-name rows exist too — so it is checked against users rather than
  // notified blind, and a name that resolves to nobody falls through.
  const salesPerson = (project?.get('sales_person') as string) || '';
  if (salesPerson) {
    const owner = await db.User.findOne({ where: { username: salesPerson, status: 'active' } as never, attributes: ['username'] });
    if (owner) return owner.get('username') as string;
  }

  // created_by is the project's internal originator — for a partner
  // submission that is already the relationship manager, so this covers the
  // common case before the explicit lookup below.
  const createdBy = (project?.get('created_by') as string) || '';
  if (createdBy) {
    const originator = await db.User.findByPk(createdBy, { attributes: ['username', 'status'] });
    if (originator && originator.get('status') === 'active') return originator.get('username') as string;
  }

  const partner = await findPartnerById(partnerId);
  if (partner?.relationship_manager_id) {
    const rm = await db.User.findByPk(partner.relationship_manager_id, { attributes: ['username'] });
    if (rm) return rm.get('username') as string;
  }

  return '';
}
