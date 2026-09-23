import { findUserById, findUserByUsername } from './userStore';
import { canActOnBehalf } from './quotationOnBehalfAccess';
import { canAccessProject, findProjectById } from './projectStore';
import { isTechnicalRole, SALES_DEPARTMENTS } from './technicalRoles';
import { UserRecord } from './types';

export interface ResolvedPreparedBy {
  userId: string;
  name: string;
  phone: string;
  email: string;
}

export type PreparedByResolution = { ok: true; value: ResolvedPreparedBy } | { ok: false; status: number; error: string };

// The one "someone else" a technical-staff member may prepare a quotation
// for: the sales person who OWNS the project it's linked to (Project.
// created_by), so the quotation lands in that sales person's pipeline rather
// than the engineer's. Only when the acting user can actually open that
// project and the owner is still active — undefined otherwise. Shared by
// resolvePreparedBy below and the on-behalf-options route (which offers this
// owner as the picker's only alternative to self).
export async function findLinkedProjectOwner(actingUsername: string, projectId: string): Promise<UserRecord | undefined> {
  if (!projectId) return undefined;
  const project = await findProjectById(projectId);
  if (!project || !project.created_by) return undefined;
  if (!(await canAccessProject(actingUsername, project))) return undefined;
  const owner = await findUserByUsername(project.created_by);
  // Only a real sales owner (active, in Sales / GEM - Sales — the same rule
  // lib/projectSalesOwner.ts applies). A legacy project owned by an admin,
  // superadmin or another engineer falls back to "prepared by me" rather
  // than issuing the quote in their name or exposing their contact details.
  return owner && owner.status === 'active' && SALES_DEPARTMENTS.includes(owner.department) ? owner : undefined;
}

// Server-side source of truth for "who is this quotation prepared by" —
// prepared_by/_phone/_email are never taken from client-sent strings
// (previously the API accepted arbitrary free text there with zero
// validation). Shared by the create and revise routes, the only two places
// that ever write these columns.
//
// requestedUserId is optional; omitted (or equal to the acting user's own
// id) always resolves to the acting user themselves — no permission check,
// exactly today's behavior. Only an actual delegation (a DIFFERENT user id)
// requires the acting user to be on the ON_BEHALF_USERNAMES allowlist, which
// closes the "anyone could already set an arbitrary prepared_by" gap for
// everyone, not just the new delegation case. The one narrow exception:
// technical staff may delegate to the linked project's sales owner
// (options.projectId, see findLinkedProjectOwner) — and to nobody else.
export async function resolvePreparedBy(
  actingUsername: string,
  requestedUserId: string | undefined,
  options: { projectId?: string } = {}
): Promise<PreparedByResolution> {
  const actingUser = await findUserByUsername(actingUsername);
  if (!actingUser) return { ok: false, status: 401, error: 'Unauthorized' };

  const wantsSomeoneElse = !!requestedUserId && requestedUserId !== actingUser.id;
  if (!wantsSomeoneElse) {
    return { ok: true, value: { userId: actingUser.id, name: actingUser.name, phone: actingUser.phone, email: actingUser.email } };
  }

  if (!canActOnBehalf(actingUsername)) {
    if (isTechnicalRole(actingUser.role) && options.projectId) {
      const owner = await findLinkedProjectOwner(actingUsername, options.projectId);
      if (owner && owner.id === requestedUserId) {
        return { ok: true, value: { userId: owner.id, name: owner.name, phone: owner.phone, email: owner.email } };
      }
      return { ok: false, status: 403, error: "You can only prepare this quotation on behalf of the linked project's sales person" };
    }
    return { ok: false, status: 403, error: 'You are not permitted to create a quotation on behalf of another team member' };
  }

  const target = await findUserById(requestedUserId as string);
  if (!target) return { ok: false, status: 400, error: 'Selected team member not found' };
  if (target.status !== 'active') return { ok: false, status: 400, error: 'Selected team member is not active' };

  return { ok: true, value: { userId: target.id, name: target.name, phone: target.phone, email: target.email } };
}
