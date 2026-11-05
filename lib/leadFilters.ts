// Sentinel values for the Leads list's "Assigned to" and "Where from" filters
// — shared between components/LeadsView.tsx (which sends them as query
// params) and lib/leadStore.ts (which interprets them server-side). Prefixed
// so none can ever collide with a real user id or a real lead_source value.
export const FILTER_UNASSIGNED = '@unassigned';
export const FILTER_MINE = '@mine';
export const FILTER_UNSET = '@unset';
