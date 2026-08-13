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
// is null (ai-analytics, where name is a live join key elsewhere). When
// `base` is `{}` (a brand-new, admin-created product with no hardcoded
// entry), this just returns `override.fields` verbatim — the override row
// for a new product carries the COMPLETE record, not a partial patch.
export function applyOverride<T extends object>(base: T, override: CatalogOverrideRow | undefined, nameField: string | null): T {
  if (!override) return base;
  const next: Record<string, unknown> = { ...base, ...(override.fields || {}) };
  if (nameField && override.name) next[nameField] = override.name;
  return next as T;
}

// Product keys that exist only as an override row (an admin-added new
// product) for this catalog — not in the hardcoded catalog's own keys.
// Estimators union this onto their hardcoded key list so new products show
// up as selectable options.
export function extraProductKeys(catalogId: string, baseKeys: string[], overrides: OverrideMap): string[] {
  const baseSet = new Set(baseKeys);
  const extra: string[] = [];
  overrides.forEach((row) => {
    if (row.catalog === catalogId && !baseSet.has(row.productKey) && !extra.includes(row.productKey)) {
      extra.push(row.productKey);
    }
  });
  return extra;
}
