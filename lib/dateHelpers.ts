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

// A 'YYYY-MM' month key -> its [from, to) DATEONLY bounds, e.g. '2026-12' ->
// { from: '2026-12-01', to: '2027-01-01' }. null for anything that isn't a
// real month key. Pure string math — no Date/timezone involvement, so a
// DATEONLY column compared against these can never shift across a month
// boundary.
export function monthKeyBounds(key: string): { from: string; to: string } | null {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(key);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return { from: `${match[1]}-${match[2]}-01`, to: `${nextYear}-${pad(nextMonth)}-01` };
}

export type ClosingDatePreset = 'all' | 'today' | 'this_week' | 'this_month' | 'next_7' | 'next_30' | 'custom';

function toDateInputValue(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Shared by the Project Dashboard's closing-date filter (client-side) and
// Analytics' closing-date filter (server query params) — one definition of
// what each preset means so the two pages can never quietly disagree.
// Returns '' for `from`/`to` when the preset is 'all' (no bound) or
// 'custom' (caller supplies its own two date inputs instead).
export function closingDatePresetRange(preset: ClosingDatePreset): { from: string; to: string } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  switch (preset) {
    case 'today':
      return { from: toDateInputValue(today), to: toDateInputValue(today) };
    case 'this_week': {
      // Monday-start week, matching this app's other week-bounded views.
      const day = today.getDay();
      const diffToMonday = day === 0 ? 6 : day - 1;
      const start = new Date(today);
      start.setDate(today.getDate() - diffToMonday);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      return { from: toDateInputValue(start), to: toDateInputValue(end) };
    }
    case 'this_month': {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      return { from: toDateInputValue(start), to: toDateInputValue(end) };
    }
    case 'next_7': {
      const end = new Date(today);
      end.setDate(today.getDate() + 7);
      return { from: toDateInputValue(today), to: toDateInputValue(end) };
    }
    case 'next_30': {
      const end = new Date(today);
      end.setDate(today.getDate() + 30);
      return { from: toDateInputValue(today), to: toDateInputValue(end) };
    }
    case 'all':
    case 'custom':
    default:
      return { from: '', to: '' };
  }
}
