import { findUserById, findUserByUsername } from './userStore';
import { canActOnBehalf } from './quotationOnBehalfAccess';

export interface ResolvedPreparedBy {
  userId: string;
  name: string;
  phone: string;
  email: string;
}

export type PreparedByResolution = { ok: true; value: ResolvedPreparedBy } | { ok: false; status: number; error: string };

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
// everyone, not just the new delegation case.
export async function resolvePreparedBy(actingUsername: string, requestedUserId: string | undefined): Promise<PreparedByResolution> {
  const actingUser = await findUserByUsername(actingUsername);
  if (!actingUser) return { ok: false, status: 401, error: 'Unauthorized' };

  const wantsSomeoneElse = !!requestedUserId && requestedUserId !== actingUser.id;
  if (!wantsSomeoneElse) {
    return { ok: true, value: { userId: actingUser.id, name: actingUser.name, phone: actingUser.phone, email: actingUser.email } };
  }

  if (!canActOnBehalf(actingUsername)) {
    return { ok: false, status: 403, error: 'You are not permitted to create a quotation on behalf of another team member' };
  }

  const target = await findUserById(requestedUserId as string);
  if (!target) return { ok: false, status: 400, error: 'Selected team member not found' };
  if (target.status !== 'active') return { ok: false, status: 400, error: 'Selected team member is not active' };

  return { ok: true, value: { userId: target.id, name: target.name, phone: target.phone, email: target.email } };
}
