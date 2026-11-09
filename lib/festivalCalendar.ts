// Fixed, hand-maintained calendar of Indian festivals this app sends a
// company-wide greeting for — same philosophy as birthdays/anniversaries
// (lib/celebrationStore.ts), but festival dates are a shared, global
// calendar rather than a per-user field, and several of them follow the
// lunar/Islamic calendar, so they CANNOT be computed from a formula the way
// a birthday's month/day can.
//
// Deliberately a static table, not a live calendar API call: there is no
// existing external-API integration in this app for anything but email/SES
// and Meta's webhook, and a wrong auto-computed date (especially Eid, which
// is confirmed only by moon sighting a day or two ahead) is worse than a
// correct hand-entered one. Update this list once a year — add next year's
// dates when they're officially confirmed (the Eid entries specifically
// should be treated as provisional until confirmed closer to the date; see
// each entry's own note).
//
// Source: the Government of India's DoPT gazetted-holiday circular for the
// relevant year, cross-checked against multiple festival calendars where
// DoPT doesn't cover a date (fixed-date national days are exact; lunar
// festival dates can still shift by a day by local/regional observance).

export interface FestivalEntry {
  /** Stable key — used for the per-day dedup marker (`festival_<key>`) and must never change once used. */
  key: string;
  name: string;
  /** 'YYYY-MM-DD' — the specific year this entry is confirmed for. One row per year; see the list below. */
  date: string;
  greeting: string;
  /** True only for a lunar-calendar date not yet officially confirmed (currently just the Eid entries for 2027) — shown nowhere yet, but kept here so a future admin screen can flag it. */
  provisional?: boolean;
}

export const FESTIVALS: FestivalEntry[] = [
  // --- Remaining 2026 ---
  { key: 'christmas', name: 'Christmas', date: '2026-12-25', greeting: 'Merry Christmas! Wishing you joy, warmth, and wonderful moments with your loved ones.' },

  // --- 2027 ---
  { key: 'republic-day', name: 'Republic Day', date: '2027-01-26', greeting: 'Happy Republic Day! Celebrating the spirit of our Constitution and the unity of our nation.' },
  { key: 'eid-ul-fitr', name: 'Eid-ul-Fitr', date: '2027-03-10', greeting: 'Eid Mubarak! Wishing you and your family peace, happiness, and prosperity.', provisional: true },
  { key: 'holi', name: 'Holi', date: '2027-03-23', greeting: 'Happy Holi! May your life be filled with as many colours as the festival itself.' },
  { key: 'eid-ul-adha', name: 'Eid-ul-Adha (Bakrid)', date: '2027-05-17', greeting: 'Eid Mubarak! Wishing you a blessed Bakrid filled with warmth and togetherness.', provisional: true },
  { key: 'independence-day', name: 'Independence Day', date: '2027-08-15', greeting: 'Happy Independence Day! Proud to celebrate the freedom and spirit of our nation together.' },
  { key: 'raksha-bandhan', name: 'Raksha Bandhan', date: '2027-08-17', greeting: 'Happy Raksha Bandhan! Celebrating the bonds that protect and strengthen us.' },
  { key: 'ganesh-chaturthi', name: 'Ganesh Chaturthi', date: '2027-09-04', greeting: 'Happy Ganesh Chaturthi! May Lord Ganesha bring wisdom, prosperity, and good fortune to you and your family.' },
  { key: 'gandhi-jayanti', name: 'Gandhi Jayanti', date: '2027-10-02', greeting: "Remembering Mahatma Gandhi's vision of truth and non-violence on his birth anniversary." },
  { key: 'dussehra', name: 'Dussehra', date: '2027-10-09', greeting: 'Happy Dussehra! Wishing you the strength to overcome every challenge, just as good triumphs over evil.' },
  { key: 'diwali', name: 'Diwali', date: '2027-10-29', greeting: 'Happy Diwali! May this festival of lights bring prosperity, joy, and brightness to you and your family.' },
  { key: 'christmas-2027', name: 'Christmas', date: '2027-12-25', greeting: 'Merry Christmas! Wishing you joy, warmth, and wonderful moments with your loved ones.' }
];

/** Today's festival, if any — IST calendar day, matching the rest of this app's date conventions (see lib/dailyReportTime.ts). */
export function getTodaysFestival(referenceDate: Date = new Date()): FestivalEntry | null {
  const istDateOnly = new Date(referenceDate.getTime() + 330 * 60_000).toISOString().slice(0, 10);
  return FESTIVALS.find((f) => f.date === istDateOnly) ?? null;
}
