// Pure — no DB — so the team dashboard, its range view and the team matrix
// share one rule for a department filter, and it can be tested directly.

/**
 * Applies a department filter (one id or several — the multi-select team
 * filters) to a viewer's scope. Each requested id is checked against the
 * scope on its own, so a department filter can only ever NARROW what the
 * viewer may already see; when none of the requested ids is in scope the
 * result falls back to the whole scope rather than leaking anything, exactly
 * as the single-id filter always has.
 *
 * `narrowed` is true whenever a department was requested at all (in scope or
 * not) — the callers drop the viewer's named direct reports in that case, so
 * a picked department means that department and nothing else.
 */
export function narrowDepartmentScope(
  scopeDepartmentIds: string[],
  requested: string | string[] | undefined
): { departmentIds: string[]; narrowed: boolean } {
  const list = (Array.isArray(requested) ? requested : requested ? [requested] : []).filter(Boolean);
  if (!list.length) return { departmentIds: scopeDepartmentIds, narrowed: false };
  const allowed = scopeDepartmentIds.filter((id) => list.includes(id));
  return { departmentIds: allowed.length ? allowed : scopeDepartmentIds, narrowed: true };
}
