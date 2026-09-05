import { db } from './db';
import { getAppConfig } from './appConfigStore';
import { ReimbursementDeadlineInfo } from './types';

// Effective deadline for one (year, month): whichever extension row for
// that period was created most recently, falling back to the admin-
// configured global default (AppConfig.reimbursementDeadlineDay). Extension
// rows are never updated in place — see the migration comment
// (20260908100000-reimbursement-deadline.js) — so "most recent" is what
// actually governs, same pattern as tms_project_deadline_extensions.
export async function getEffectiveDeadline(year: number, month: number): Promise<Omit<ReimbursementDeadlineInfo, 'canExtend'>> {
  const latestExtension = await db.ReimbursementDeadlineExtension.findOne({
    where: { year, month } as never,
    include: [{ model: db.User, as: 'extendedByUser', attributes: ['id', 'name', 'username'] }],
    order: [['createdAt', 'DESC']]
  });

  if (latestExtension) {
    const plain = latestExtension.get({ plain: true }) as Record<string, unknown>;
    const extender = plain.extendedByUser as { name?: string; username?: string } | null;
    return {
      year,
      month,
      day: plain.extended_to_day as number,
      extended: true,
      extendedByName: extender?.name || extender?.username || ''
    };
  }

  const config = await getAppConfig();
  return { year, month, day: config.reimbursementDeadlineDay, extended: false, extendedByName: '' };
}

// Records a new extension for (year, month) — an additive history row, not
// an overwrite of any prior extension for that same period (see module
// comment above for why "most recent wins" instead).
export async function extendDeadline(year: number, month: number, extendedToDay: number, extendedByUsername: string): Promise<Omit<ReimbursementDeadlineInfo, 'canExtend'>> {
  const user = await db.User.findOne({ where: { username: extendedByUsername } as never, attributes: ['id'] });
  await db.ReimbursementDeadlineExtension.create({
    year,
    month,
    extended_to_day: extendedToDay,
    extended_by: user ? user.get('id') : null
  } as never);
  return getEffectiveDeadline(year, month);
}
