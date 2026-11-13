import { db } from './db';
import { getAppConfig } from './appConfigStore';

export interface MarketingRosterEntry {
  id: string;
  username: string;
  name: string;
  department: string;
  role?: string;
}

export async function listMarketingRoster(): Promise<MarketingRosterEntry[]> {
  const appConfig = await getAppConfig().catch(() => null);
  const marketingOwner = appConfig?.marketingOwnerUsername?.toLowerCase() || '';

  // 1. Fetch active users with their role and department
  const rows = await db.User.findAll({
    where: { status: 'active' } as never,
    include: [
      { model: db.Role, as: 'role', attributes: ['id', 'key', 'label'] },
      { model: db.Department, as: 'departmentRef', attributes: ['id', 'name'] }
    ],
    order: [['name', 'ASC']]
  });

  const allUsers: MarketingRosterEntry[] = rows.map((row) => {
    const plain = row.get({ plain: true }) as Record<string, unknown>;
    const roleObj = plain.role as { key?: string; label?: string } | null;
    const deptObj = plain.departmentRef as { name?: string } | null;
    return {
      id: plain.id as string,
      username: plain.username as string,
      name: (plain.name as string) || (plain.username as string),
      department: deptObj?.name ?? (plain.department as string) ?? '',
      role: roleObj?.key ?? ''
    };
  });

  // Department is the real signal — a user's role key can read 'marketing'
  // while they actually sit in a different department (e.g. someone moved
  // from Marketing into HR & Admin but was never given a new role), which
  // previously leaked them into this roster by role alone. Department,
  // or an explicitly configured Marketing Owner override, are authoritative.
  const marketingUsers = allUsers.filter(
    (u) =>
      u.department.toLowerCase().startsWith('marketing') ||
      (marketingOwner && u.username.toLowerCase() === marketingOwner)
  );

  // If specific marketing accounts are found, return them. Otherwise return all active users so selection is never blocked.
  if (marketingUsers.length > 0) {
    return marketingUsers;
  }

  return allUsers;
}
