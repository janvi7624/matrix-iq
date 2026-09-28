import { db } from './db';
import { PROJECT_LEAD_USERNAMES, ProjectLeadOption } from './projectLeadOptions';

// The people currently offered as a project's Lead / Mentor, in the order
// lib/projectLeadOptions.ts lists them. Active accounts only — a deactivated
// lead drops out of the dropdown (and is refused by resolveProjectLead) instead
// of staying pickable, same reasoning as every other person-picker in the app.
export async function listProjectLeads(): Promise<ProjectLeadOption[]> {
  const rows = await db.User.findAll({
    where: { username: [...PROJECT_LEAD_USERNAMES], status: 'active' } as never,
    attributes: ['id', 'username', 'name']
  });
  return rows
    .map((r) => ({ id: r.get('id') as string, username: r.get('username') as string, name: (r.get('name') as string) || (r.get('username') as string) }))
    .sort((a, b) => (PROJECT_LEAD_USERNAMES as readonly string[]).indexOf(a.username) - (PROJECT_LEAD_USERNAMES as readonly string[]).indexOf(b.username));
}

// Validates a client-supplied project lead id against the list above — the
// dropdown is a convenience, this is the actual rule. null when the id is
// blank, not one of the fixed leads, or the lead is no longer active.
export async function resolveProjectLead(id: unknown): Promise<ProjectLeadOption | null> {
  if (typeof id !== 'string' || !id.trim()) return null;
  return (await listProjectLeads()).find((l) => l.id === id.trim()) ?? null;
}
