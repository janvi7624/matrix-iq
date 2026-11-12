import { db } from './db';

// Per-person reporting lines.
//
// Before this, "who manages this person" had exactly one answer anywhere in
// the app: Department.managerIds. Being in Sales meant reporting to the Sales
// manager, because the department WAS the reporting line. That is still true
// for almost everyone and stays the default — this module only handles the
// cases where one person reports to somebody other than their department's
// manager (today: Ajay Shankar BP reports to Mahendra Singh Chauhan, while
// the rest of Sales, Mahendra included, still reports to Manoj Menon).
//
// ADDITIVE, not exclusive. A reporting manager is added to the people who
// receive and may act on that person's requests; the department manager is
// never removed. Two reasons, both load-bearing:
//   * a request can never become unactionable because one named person is on
//     leave — the department manager is always still there;
//   * the department manager's existing visibility is what every other part
//     of the app already assumes (department health, targets, team views), so
//     taking it away here would break things far from this file.
// If the requirement ever becomes "and the department manager must NOT see
// it", that is a different, deliberate change and belongs in the routing
// call sites, not here.
//
// One hop only. This resolves a person's own manager, never a chain up to the
// top, so a cycle (A reports to B, B reports to A) cannot cause recursion —
// it would just mean each is the other's approver. The API still refuses to
// let someone be their own manager, because that is always a mistake.

/** The manager this person reports to directly, or null when unset. */
export async function reportingManagerIdFor(userId: string): Promise<string | null> {
  if (!userId) return null;
  const row = await db.User.findByPk(userId, { attributes: ['reportingManagerId'] });
  return row ? ((row.get('reportingManagerId') as string | null) ?? null) : null;
}

/**
 * Ids of the people who report directly to this manager.
 *
 * Active, non-deleted staff only. A deactivated account's records should not
 * reappear in a manager's queue, and `paranoid: true` on the model already
 * excludes soft-deleted rows.
 */
export async function directReportIdsFor(managerId: string): Promise<string[]> {
  if (!managerId) return [];
  const rows = await db.User.findAll({
    where: { reportingManagerId: managerId, status: 'active' } as never,
    attributes: ['id']
  });
  return rows.map((r) => r.get('id') as string);
}

/**
 * Same, for a manager identified by username.
 *
 * Most access code in the app carries the viewer's username rather than their
 * id (resolveVisibilityScope, departmentsManagedBy), so this saves every
 * caller the same extra lookup.
 */
export async function directReportIdsForUsername(username: string): Promise<string[]> {
  if (!username) return [];
  const manager = await db.User.findOne({ where: { username } as never, attributes: ['id'] });
  return manager ? directReportIdsFor(manager.get('id') as string) : [];
}

/**
 * Does this person manage that one, by either route?
 *
 * The direct-reportee test only — department management is a separate
 * question its own callers already answer (departmentsManagedBy), and
 * conflating them here would hide which rule granted the access.
 */
export async function isDirectReportOf(managerId: string, employeeId: string): Promise<boolean> {
  if (!managerId || !employeeId) return false;
  return (await reportingManagerIdFor(employeeId)) === managerId;
}
