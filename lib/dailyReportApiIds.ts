// Two shape checks the route handlers need before they touch a store.
//
// Separate from lib/db.ts's isUuid only so a route can validate a request
// body without importing the module that loads Sequelize — the check itself
// is identical, and both exist for the same reason: Postgres raises a hard
// "invalid input syntax for type uuid" for a malformed id rather than simply
// finding no row, which would turn a bad request into a 500.
export { isIsoDate } from './dailyReportTime';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuidLike(value: string): boolean {
  return UUID_RE.test(value);
}
