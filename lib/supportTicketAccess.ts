import { db } from './db';
import { SupportActor } from './supportTicketWorkflow';
import { TMS_ROLE_KEYS } from './tmsConstants';

// Who counts as what on a support ticket.
//
// The workflow table (lib/supportTicketWorkflow.ts) is keyed on three actor
// kinds rather than on role strings; this file is the mapping. Keeping it
// separate means adding a role never requires editing the transition table.

const MANAGER_ROLES = ['superadmin', 'admin', 'technical-manager'];
// 'manager' (the generic one) is deliberately absent: it is held by every
// department's manager — Sales, HR, Accounts — and the support queue is the
// technical team's, not everyone's. Same reasoning TMS already applies in
// lib/moduleConfigStore.ts, where the generic manager role is kept out of
// TMS_OVERSIGHT_ROLES.

const ENGINEER_ROLES = ['engineer', 'technician', 'team-lead'];

export interface SupportViewer {
  userId: string;
  username: string;
  role: string;
  isPrivileged: boolean;
  partnerId: string;
}

/**
 * Which actor this viewer is.
 *
 * partnerId wins over everything: an external account is a partner no matter
 * what role string it carries, which is the same defence-in-depth rule the
 * module gate uses.
 */
export function resolveSupportActor(viewer: SupportViewer): SupportActor | null {
  if (viewer.partnerId) return 'partner';
  if (MANAGER_ROLES.includes(viewer.role)) return 'manager';
  if (ENGINEER_ROLES.includes(viewer.role)) return 'engineer';
  // Everyone else — Sales, Marketing, Accounts, HR — may RAISE a ticket and
  // follow their own, but has no queue role. Treated as 'partner'-shaped for
  // workflow purposes would be wrong (they are internal and may see internal
  // notes), so they get no actor and the route falls back to read-only.
  return null;
}

/** May this viewer work the support queues at all? */
export function canWorkSupportQueue(viewer: SupportViewer): boolean {
  return resolveSupportActor(viewer) === 'manager' || resolveSupportActor(viewer) === 'engineer';
}

/**
 * Can this internal viewer open this ticket?
 *
 * Managers see everything. Engineers see their own assignments plus the
 * unassigned pool (they cannot pick work up otherwise). Anyone else sees
 * tickets they raised.
 *
 * Partners never reach this function — their access is resolved by
 * partner_id in the query (lib/supportTicketStore.ts).
 */
export async function canViewTicket(viewer: SupportViewer, ticket: { created_by_user_id: string; assigned_to_id: string }): Promise<boolean> {
  if (viewer.partnerId) return false;
  const actor = resolveSupportActor(viewer);
  if (actor === 'manager') return true;
  if (ticket.created_by_user_id === viewer.userId) return true;
  if (actor === 'engineer') {
    if (ticket.assigned_to_id === viewer.userId) return true;
    // The unassigned pool is visible so engineers can see incoming work.
    if (!ticket.assigned_to_id) return true;
  }
  return false;
}

/** Internal users who may be assigned a ticket — the technical roster. */
export async function listAssignableEngineers(): Promise<{ id: string; name: string; username: string; role: string }[]> {
  const rows = await db.User.findAll({
    where: { status: 'active' } as never,
    include: [{ model: db.Role, as: 'role', attributes: ['key'], required: true }],
    attributes: ['id', 'name', 'username']
  });
  return rows
    .map((row) => {
      const plain = row.get({ plain: true }) as Record<string, unknown>;
      return {
        id: plain.id as string,
        name: (plain.name as string) || (plain.username as string),
        username: plain.username as string,
        role: (plain.role as { key?: string } | null)?.key ?? ''
      };
    })
    .filter((u) => (TMS_ROLE_KEYS as readonly string[]).includes(u.role))
    .sort((a, b) => a.name.localeCompare(b.name));
}
