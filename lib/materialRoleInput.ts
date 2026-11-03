import { listRoles } from './roleStore';

/**
 * The `visibleToRoles` list off a request body, validated against the roles
 * that actually exist.
 *
 * Shared by the three write paths (a folder, a new document, an edited
 * document) because an unknown role key fails SILENTLY: it matches nobody,
 * so a single typo — "enginer" for "engineer" — produces a folder that
 * exists, contains the right file, and is permanently invisible to every
 * person in the company. Nothing anywhere would report that. Validating on
 * the way in is the only cheap place to catch it.
 *
 * Checked against the live table rather than a constant, because roles are
 * created in Role Management at runtime: lib/types.ts defines `UserRole` as
 * `string` precisely because there is no fixed set to check against.
 *
 * An absent or empty list means "every internal role" and skips the lookup —
 * that is the common case for ordinary collateral, and it is also the answer
 * for a body that never mentioned roles at all.
 */
export async function readMaterialRoleList(value: unknown): Promise<string[]> {
  if (!Array.isArray(value) || value.length === 0) return [];
  const known = new Set((await listRoles()).map((role) => role.key));
  return [...new Set(value.filter((entry): entry is string => typeof entry === 'string' && known.has(entry)))];
}

/**
 * Whether a body asked about roles at all.
 *
 * An edit has to tell "leave the roles alone" apart from "open this back up
 * to everyone", and both arrive as a falsy `visibleToRoles` — absent for the
 * first, `[]` for the second. Without this distinction every unrelated edit
 * to a restricted document (fixing its title) would silently un-restrict it.
 */
export function mentionsRoles(body: Record<string, unknown>): boolean {
  return Array.isArray(body.visibleToRoles);
}
