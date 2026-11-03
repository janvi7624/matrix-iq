import { Op } from 'sequelize';
import { TmsProjectRecord } from './types';
import { db, isUuid } from './db';
import { resolveVisibilityScope } from './departmentScope';
import { tmsProjectStore } from './tmsProjectStore';

// The Sales side's own narrow window into TMS: "My Sold Projects" — every
// TMS project tied to a deal THIS person sold (TmsProject.sales_person_username,
// set once by lib/tmsHandoff.ts at handoff), or their whole team's if they
// manage the Sales department. Completely separate from lib/tmsAccess.ts's
// TmsViewer/department-tier model, which governs the TMS STAFF side (Robotics/
// AI/AV membership, role tiers) — a Sales account holds none of that, and
// this file never touches it. Read-only by construction: nothing here writes.
//
// Reuses resolveVisibilityScope — the same "own records, or the whole team if
// you manage the department" rule Billing/Client Master/Delivery Challans
// already use for the Sales side, so a sales manager's reach here matches
// what they already see everywhere else, instead of a second definition that
// could drift from it.

async function scopedSalesUsernames(viewerUsername: string): Promise<{ seesAll: boolean; usernames: string[] }> {
  const scope = await resolveVisibilityScope(viewerUsername);
  if (scope.seesOrgWide) return { seesAll: true, usernames: [] };
  const ids = scope.scopedUserIds ?? [];
  if (!ids.length) return { seesAll: false, usernames: [] };
  const users = await db.User.findAll({ where: { id: ids } as never, attributes: ['username'] });
  return { seesAll: false, usernames: users.map((u) => u.get('username') as string).filter(Boolean) };
}

/**
 * Every TMS project this viewer may see on the Sales side — their own sold
 * projects, or their team's if they manage Sales. Only projects a Sales
 * handoff actually created (sales_person_username set) ever qualify; a
 * project started natively inside TMS has no sales owner and never appears
 * here, even for a viewer who "sees org-wide" (an admin's reach into THIS
 * page is still "every sold project", not "every TMS project" — that is
 * /tms/projects).
 */
export async function listTmsProjectsSoldBy(viewerUsername: string): Promise<TmsProjectRecord[]> {
  const { seesAll, usernames } = await scopedSalesUsernames(viewerUsername);
  if (!seesAll && !usernames.length) return [];

  const rows = await db.TmsProject.findAll({
    where: (seesAll
      ? { [Op.and]: [{ sales_person_username: { [Op.ne]: null } }, { sales_person_username: { [Op.ne]: '' } }] }
      : { sales_person_username: usernames }) as never,
    attributes: ['id'],
    order: [['created_at', 'DESC']]
  });
  const ids = rows.map((r) => r.get('id') as string);
  if (!ids.length) return [];
  const records = await Promise.all(ids.map((id) => tmsProjectStore.findById(id)));
  return records.filter((r): r is TmsProjectRecord => !!r);
}

/** Single-record check for the detail route — mirrors canAccessOwnedRecord's shape. */
export async function canViewTmsProjectAsSales(viewerUsername: string, project: TmsProjectRecord): Promise<boolean> {
  if (!project.sales_person_username) return false;
  const { seesAll, usernames } = await scopedSalesUsernames(viewerUsername);
  if (seesAll) return true;
  return usernames.includes(project.sales_person_username);
}

export async function findSoldTmsProjectForViewer(viewerUsername: string, projectId: string): Promise<TmsProjectRecord | undefined> {
  if (!isUuid(projectId)) return undefined;
  const project = await tmsProjectStore.findById(projectId);
  if (!project) return undefined;
  return (await canViewTmsProjectAsSales(viewerUsername, project)) ? project : undefined;
}
