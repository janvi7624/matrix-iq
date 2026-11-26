// Multi-value query parameters for list filters.
//
// A multi-select filter sends one parameter per chosen value:
//   /api/leads?priority=hot&priority=warm
// (repeated keys, NOT a comma-joined string — values such as company names
// can contain commas). A single value — every existing link, bookmark and
// caller — still works unchanged: ?priority=hot → ['hot'].

/** All non-empty values of a query parameter, de-duplicated, in order. */
export function getListParam(params: URLSearchParams, name: string): string[] {
  const out: string[] = [];
  for (const raw of params.getAll(name)) {
    const v = raw.trim();
    if (v && v !== 'all' && !out.includes(v)) out.push(v);
  }
  return out;
}

/** Appends one `name=value` pair per value (no-op for an empty list). */
export function setListParam(params: URLSearchParams, name: string, values: readonly string[]): void {
  params.delete(name);
  for (const v of values) if (v) params.append(name, v);
}

/** In-memory filter test: an empty list means "no filter". */
export function matchesList(value: string | null | undefined, list: readonly string[]): boolean {
  return list.length === 0 || (value != null && list.includes(value));
}
