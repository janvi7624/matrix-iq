// Generic client-safe merge helper shared by every estimator and the admin
// product-catalog page — applies a persisted override on top of a catalog's
// hardcoded base record. See lib/catalogRegistry.ts for the catalog table.
export interface CatalogOverrideRow {
  catalog: string;
  productKey: string;
  name: string | null;
  fields: Record<string, unknown> | null;
}

export type OverrideMap = Map<string, CatalogOverrideRow>;

export function overrideMapKey(catalog: string, productKey: string): string {
  return `${catalog}::${productKey}`;
}

export function buildOverrideMap(rows: CatalogOverrideRow[]): OverrideMap {
  const map: OverrideMap = new Map();
  rows.forEach((r) => map.set(overrideMapKey(r.catalog, r.productKey), r));
  return map;
}

// Base record patched with override.fields, plus the rename applied to
// whichever field `nameField` points at — skipped entirely when `nameField`
// is null (ai-analytics, where name is a live join key elsewhere).
export function applyOverride<T extends object>(base: T, override: CatalogOverrideRow | undefined, nameField: string | null): T {
  if (!override) return base;
  const next: Record<string, unknown> = { ...base, ...(override.fields || {}) };
  if (nameField && override.name) next[nameField] = override.name;
  return next as T;
}
