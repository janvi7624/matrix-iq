import { db } from './db';
import { hasCapability } from './permissions';
import { departmentsManagedBy } from './departmentStore';

export interface VisibilityScope {
  // true: no filtering needed, the caller sees every record (Admin/Super
  // Admin by default, or any role explicitly granted the viewAllDepartments
  // capability in Role Management).
  seesOrgWide: boolean;
  // null only when seesOrgWide is true. Otherwise the full set of user ids
  // whose records this viewer may see: their own id, plus — if they manage
  // one or more departments (Department.managerIds) — every active user in
  // those department(s) too. A viewer who manages no department gets back
  // exactly [ownId], identical to the app's original own-records-only rule.
  scopedUserIds: string[] | null;
}

const UNKNOWN_USER_ID = '00000000-0000-0000-0000-000000000000';

// The one place every store's list() should resolve "which records can this
// viewer see" from, replacing the old blanket isPrivileged check. Takes only
// a username — no call-site signature changes needed anywhere else in the
// app; each store still receives (viewerUsername, viewerIsPrivileged) as
// before and keeps using viewerIsPrivileged for whatever capability checks
// already lived in that file (e.g. remove()), only the visibility branch
// changes to call this instead.
export async function resolveVisibilityScope(viewerUsername: string): Promise<VisibilityScope> {
  const user = await db.User.findOne({ where: { username: viewerUsername } as never, include: [{ model: db.Role, as: 'role', attributes: ['key'] }] });
  if (!user) return { seesOrgWide: false, scopedUserIds: [UNKNOWN_USER_ID] };

  const plain = user.get({ plain: true }) as Record<string, unknown>;
  const ownUserId = plain.id as string;
  const roleKey = (plain.role as { key?: string } | null)?.key ?? '';

  if (await hasCapability(roleKey, 'viewAllDepartments')) {
    return { seesOrgWide: true, scopedUserIds: null };
  }

  const managed = await departmentsManagedBy(viewerUsername);
  if (!managed.length) {
    return { seesOrgWide: false, scopedUserIds: [ownUserId] };
  }

  const members = await db.User.findAll({
    where: { departmentId: managed.map((d) => d.id) } as never,
    attributes: ['id']
  });
  const scopedUserIds = Array.from(new Set([ownUserId, ...members.map((m) => m.get('id') as string)]));
  return { seesOrgWide: false, scopedUserIds };
}

// Single-record access check for the simple "record has one created_by
// username" shape (Quotations, Site Visits, Leads, Delivery Challans) —
// mirrors the department-scoped list() rule those stores now use, so a
// department manager can open a team member's record directly by id, but
// nobody can reach another department's record just by knowing its id. Not
// for Projects — those also need the assigned_technical_person_id branch,
// see app/api/projects/[id]/route.ts's own canAccessProject.
export async function canAccessOwnedRecord(viewerUsername: string, recordOwnerUsername: string): Promise<boolean> {
  const scope = await resolveVisibilityScope(viewerUsername);
  if (scope.seesOrgWide) return true;
  if (!recordOwnerUsername) return false;
  const owner = await db.User.findOne({ where: { username: recordOwnerUsername } as never, attributes: ['id'] });
  return owner ? (scope.scopedUserIds ?? []).includes(owner.get('id') as string) : false;
}
