// `min` values for date/datetime-local inputs on forward-looking fields
// (deadlines, return dates, follow-ups, reschedules) — local wall-clock
// time, not UTC, so the browser's own "today"/"now" matches what the
// picker shows. Not used on fields that log something that already
// happened (visit dates, PO dates, discussion logs) or on filter/search
// date ranges, where past dates are the whole point.
function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function todayDateInputValue(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function nowDatetimeInputValue(): string {
  const d = new Date();
  return `${todayDateInputValue()}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
