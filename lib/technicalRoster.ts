import { db } from './db';

// Single source of truth for every "pick a technical person" picker (Demo
// Schedule's assigned/attending fields, Project's assigned-technical-person
// field) — replaces the old hardcoded lib/teamMembers.ts TECHNICAL_TEAM
// first-name list with real, active User accounts.
export const TECHNICAL_DOMAIN_DEPARTMENTS = ['AV', 'Robotics', 'AI'];

export interface TechnicalRosterEntry {
  id: string;
  username: string;
  name: string;
  department: string;
}

export async function listTechnicalRoster(): Promise<TechnicalRosterEntry[]> {
  const rows = await db.User.findAll({
    where: { status: 'active' } as never,
    include: [{ model: db.Department, as: 'departmentRef', attributes: ['name'], required: true, where: { name: TECHNICAL_DOMAIN_DEPARTMENTS } as never }],
    order: [['name', 'ASC']]
  });
  return rows.map((row) => {
    const plain = row.get({ plain: true }) as Record<string, unknown>;
    return {
      id: plain.id as string,
      username: plain.username as string,
      name: plain.name as string,
      department: (plain.departmentRef as { name?: string } | null)?.name ?? ''
    };
  });
}
