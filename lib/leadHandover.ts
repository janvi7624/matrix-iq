import { listUsers, findUserById } from './userStore';
import { canViewRole, resolveIsPrivileged } from './permissions';
import { isModuleAccessAllowed } from './moduleConfigStore';
import { assignLeads, findLeadById } from './leadStore';
import { logAudit } from './auditLogStore';
import { notifyUsers } from './notificationStore';
import { sendLeadHandoverEmail } from './email/notifications';
import { LEAD_DOMAIN_TILES, LEAD_PRIORITY_META } from './leadInterestOptions';
import { LeadHandoverOutcome, LeadHandoverRecipient, LeadRecord, PublicUser, UserRole } from './types';

// Capture-time hand-over: whoever scans a card (the front desk, a colleague
// at an event) routes the lead straight to the person it belongs to, instead
// of it waiting in the unassigned queue for a sales manager to spot.
//
// Deliberately separate from the manager's assignment flow
// (app/api/leads/assign): any capturer may hand over, not just a sales
// manager, and it never auto-creates a project — turning a lead into a
// project stays the manager's assignment decision (lib/leadProjectAutomation.ts),
// the same way Meta leads land with their owner without one.

interface HandoverViewer {
  userId: string;
  role: string;
}

// Anyone active who can open Lead Capture — the recipient has to be able to
// see the lead they're sent. Not limited to Sales: a card is often for
// someone in AI, Robotics, etc. Accounts this viewer may not see at all are
// left out (see canViewRole).
//
// The capturer themselves IS included. They used to be excluded on the
// reasoning that "a lead they keep is simply theirs" — but a captured lead is
// saved UNASSIGNED, and since qualification moved to a phone call
// (lib/leadCall.ts) an unassigned lead sits in nobody's To Call queue. So a
// rep who scanned their own card at an expo had no way to put it in their own
// queue; they had to wait for a sales manager to hand them back their own
// lead. Picking yourself is now just another hand-over, with the messaging
// steps skipped (see handOverCapturedLead).
async function recipientFilter(viewer: HandoverViewer): Promise<(user: Pick<PublicUser, 'id' | 'role' | 'status' | 'department'>) => Promise<boolean>> {
  const privilegedByRole = new Map<string, Promise<boolean>>();
  return async (user) => {
    // canViewRole is about seeing OTHER people; it never needs to be asked
    // about yourself, and some role setups would answer no.
    const isSelf = user.id === viewer.userId;
    if (user.status !== 'active' || (!isSelf && !canViewRole(viewer.role, user.role))) return false;
    if (!privilegedByRole.has(user.role)) privilegedByRole.set(user.role, resolveIsPrivileged(user.role));
    const isPrivileged = await privilegedByRole.get(user.role)!;
    return isModuleAccessAllowed('leads', { role: user.role as UserRole, isPrivileged, department: user.department });
  };
}

export async function listHandoverRecipients(viewer: HandoverViewer): Promise<LeadHandoverRecipient[]> {
  const [users, canReceive] = await Promise.all([listUsers(), recipientFilter(viewer)]);
  const allowed = await Promise.all(users.map((u) => canReceive(u)));
  return users
    .filter((_, i) => allowed[i])
    .map((u) => ({ id: u.id, name: u.name || u.username, department: u.department, designation: u.designation, self: u.id === viewer.userId }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface HandoverTarget extends LeadHandoverRecipient {
  username: string;
  email: string;
}

// The same rule as the dropdown, re-checked on the server for the one id the
// client sent — the list is a convenience, not the authority.
export async function findHandoverRecipient(id: string, viewer: HandoverViewer): Promise<HandoverTarget | null> {
  const user = await findUserById(id);
  if (!user) return null;
  const canReceive = await recipientFilter(viewer);
  if (!(await canReceive(user))) return null;
  return { id: user.id, username: user.username, name: user.name || user.username, email: user.email, department: user.department, designation: user.designation, self: user.id === viewer.userId };
}

function formatCapturedAt(iso: string): string {
  const date = iso ? new Date(iso) : new Date();
  return date.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Routes a just-saved (new or merged) lead to the chosen colleague: assign,
// audit, in-app notification, email. The lead itself is already saved, so a
// failure here is reported as an outcome rather than thrown — the capturer
// must not be told "could not save" about a lead that was saved.
export async function handOverCapturedLead(
  saved: LeadRecord,
  recipient: HandoverTarget,
  actor: { username: string; name: string; role: string },
  ip: string
): Promise<{ record: LeadRecord; outcome: LeadHandoverOutcome }> {
  // Re-read with the assignee join: a merged lead comes back from the store
  // without assignee names, and its current owner is what decides below.
  const lead = (await findLeadById(saved.id)) ?? saved;

  // A re-scanned card that is already routed to someone else stays with
  // them — a capturer doesn't override a manager's (or an earlier
  // hand-over's) decision.
  if (lead.assigned_to_id && lead.assigned_to_id !== recipient.id) {
    return { record: lead, outcome: { status: 'kept_existing', toName: lead.assigned_to_name || lead.assigned_to } };
  }
  // Already with the chosen person (the same card scanned twice) — nothing
  // to change and no second email.
  if (lead.assigned_to_id === recipient.id) {
    return { record: lead, outcome: { status: 'already_with_them', toName: recipient.name } };
  }

  try {
    const { assigned } = await assignLeads([lead.id], recipient.id, actor.username);
    if (!assigned) return { record: lead, outcome: { status: 'failed', toName: recipient.name } };
  } catch (error) {
    console.error(`[lead-handover] Could not hand lead ${lead.id} over to ${recipient.username}:`, error instanceof Error ? error.message : error);
    return { record: lead, outcome: { status: 'failed', toName: recipient.name } };
  }

  const label = lead.name || lead.company || 'A new lead';
  // Keeping your own card is still a hand-over in every respect that matters
  // to the data — the lead becomes assigned, so it enters a To Call queue and
  // the audit trail records who claimed it. Only the messaging is skipped.
  const keptBySelf = recipient.username === actor.username;

  await logAudit({
    by: actor.username,
    role: actor.role,
    entityType: 'lead',
    entityId: lead.id,
    action: keptBySelf
      ? `Lead kept by the capturer at capture: ${label}`
      : `Lead handed over to ${recipient.username} at capture: ${label}`,
    previousStatus: 'unassigned',
    newStatus: recipient.username,
    remarks: `Captured by ${actor.username}`,
    ip
  });

  if (keptBySelf) {
    // No notification and no email: the person is looking at the confirmation
    // screen that says they kept it. Telling them by bell and by mail that
    // they gave themselves a lead is noise, and after an expo it is 600 of them.
    return { record: (await findLeadById(lead.id)) ?? lead, outcome: { status: 'kept_by_capturer', toName: recipient.name } };
  }

  await notifyUsers([recipient.username], {
    title: 'Lead handed over to you',
    body: `${actor.name} captured ${label}${lead.name && lead.company ? ` (${lead.company})` : ''} and passed it to you.`,
    type: 'lead_handover',
    entityType: 'lead_handover',
    entityId: lead.id
  });
  await sendLeadHandoverEmail({
    email: recipient.email,
    name: recipient.name,
    capturedBy: actor.name,
    capturedAt: formatCapturedAt(lead.created_at),
    contactName: lead.name,
    designation: lead.designation,
    company: lead.company,
    mobile: lead.mobile,
    contactEmail: lead.email,
    city: lead.city,
    priority: lead.priority ? LEAD_PRIORITY_META[lead.priority].label : '',
    interests: lead.interests.map((d) => LEAD_DOMAIN_TILES.find((t) => t.key === d)?.label || d),
    subInterests: lead.sub_interests,
    followUpActions: lead.follow_up_actions,
    budget: lead.budget,
    notes: lead.notes,
    hasCardImage: !!lead.card_image_url
  });

  return { record: (await findLeadById(lead.id)) ?? lead, outcome: { status: 'handed_over', toName: recipient.name } };
}
