// Pure decision logic for client festival campaigns — no DB, no email, so it
// is unit-testable and the store (lib/festivalCampaignStore.ts) only carries
// out what these functions decide.
//
// Every "day" here is an IST calendar day, matching lib/festivalStore.ts's
// getTodaysFestival and the rest of the app's date conventions.

export type FestivalCampaignStatus = 'awaiting_creative' | 'pending_approval' | 'approved' | 'sending' | 'sent' | 'skipped';

/** How many days before a festival MatrixIQ raises the banner request to Marketing. */
export const DEFAULT_LEAD_DAYS = 10;
/** Marketing's delivery target: this many days before the festival, leaving time to approve. */
export const CREATIVE_BUFFER_DAYS = 3;
/** Festival-day send time (IST hour, 24h). */
export const DEFAULT_SEND_HOUR_IST = 9;

const IST_OFFSET_MS = 330 * 60_000;

export function istDateOnly(at: Date): string {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function istHour(at: Date): number {
  return new Date(at.getTime() + IST_OFFSET_MS).getUTCHours();
}

export function addDays(dateOnly: string, days: number): string {
  const d = new Date(`${dateOnly}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function readPositiveInt(raw: string | undefined, fallback: number, max: number): number {
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(n) && n >= 0 && n <= max ? n : fallback;
}

/** Inside the window where the banner request should exist: [festival - leadDays, festival - 1]. */
export function shouldRaiseRequest(festivalDate: string, today: string, leadDays: number): boolean {
  return today >= addDays(festivalDate, -leadDays) && today < festivalDate;
}

/** Marketing's needed-by date — the creative buffer before the festival, but never in the past. */
export function creativeDueDate(festivalDate: string, today: string): string {
  const due = addDays(festivalDate, -CREATIVE_BUFFER_DAYS);
  return due < today ? today : due;
}

export type CampaignDayAction = 'send' | 'skip' | 'wait';

/**
 * What the sweep does with a campaign right now.
 *  - before the festival day, or before the send hour on it: wait
 *  - on/after the festival day at/after the send hour: an approved campaign
 *    sends; anything not yet approved is skipped (approval is mandatory —
 *    nothing reaches a client unreviewed)
 *  - a campaign more than a day late is skipped rather than sending a
 *    "Happy Diwali" three days after Diwali (e.g. the scheduler was down)
 */
export function campaignDayAction(status: FestivalCampaignStatus, festivalDate: string, today: string, hourIst: number, sendHourIst: number): CampaignDayAction {
  if (status === 'sent' || status === 'skipped' || status === 'sending') return 'wait';
  if (today < festivalDate) return 'wait';
  if (today === festivalDate && hourIst < sendHourIst) return 'wait';
  if (today > festivalDate) return 'skip';
  return status === 'approved' ? 'send' : 'skip';
}

// Deliberately conservative: one @, a dot in the domain, no spaces. Anything
// that fails is dropped from the send list, not "fixed".
const EMAIL_RE = /^[^\s@,;<>()"']+@[^\s@,;<>()"']+\.[a-z]{2,}$/i;

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidEmail(raw: string): boolean {
  return EMAIL_RE.test(raw.trim());
}

/** A contact field can hold several addresses ("a@x.com, b@y.com"). */
export function splitEmails(raw: string): string[] {
  return (raw || '').split(/[,;/\s]+/).map((e) => e.trim()).filter(Boolean);
}

export interface RawClientContact {
  email: string;
  name: string;
  company: string;
}

export interface CampaignRecipient {
  email: string; // normalized
  name: string;
  company: string;
}

export interface RecipientPlan {
  recipients: CampaignRecipient[];
  invalid: number;
  duplicates: number;
  unsubscribed: number;
}

/** Dedup by address (first contact with a name wins), drop invalid and opted-out addresses. */
export function buildRecipients(contacts: RawClientContact[], unsubscribed: Set<string>): RecipientPlan {
  const byEmail = new Map<string, CampaignRecipient>();
  let invalid = 0;
  let duplicates = 0;
  let optedOut = 0;

  for (const contact of contacts) {
    for (const part of splitEmails(contact.email)) {
      if (!isValidEmail(part)) { invalid++; continue; }
      const email = normalizeEmail(part);
      if (unsubscribed.has(email)) { optedOut++; continue; }
      const existing = byEmail.get(email);
      if (existing) {
        duplicates++;
        if (!existing.name && contact.name.trim()) existing.name = contact.name.trim();
        if (!existing.company && contact.company.trim()) existing.company = contact.company.trim();
        continue;
      }
      byEmail.set(email, { email, name: contact.name.trim(), company: contact.company.trim() });
    }
  }

  // Each opted-out address counts once, however many contact rows carry it.
  return { recipients: [...byEmail.values()], invalid, duplicates, unsubscribed: optedOut };
}

const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif)$/i;
const UPLOAD_URL_PREFIX = '/api/uploads/file/';

/**
 * The first image among Marketing's delivered files, as a storage pathname
 * (what lib/fileStorage.ts's getFile takes). Delivered files are stored as
 * the authenticated proxy URL `/api/uploads/file/<encoded path>`; external
 * links (Drive etc.) can't be embedded and are ignored.
 */
export function pickBannerPath(files: string[]): string | null {
  for (const file of files) {
    if (!file.startsWith(UPLOAD_URL_PREFIX)) continue;
    const pathname = file.slice(UPLOAD_URL_PREFIX.length).split('/').map((s) => {
      try { return decodeURIComponent(s); } catch { return s; }
    }).join('/');
    if (pathname.includes('..')) continue;
    if (IMAGE_EXT_RE.test(pathname)) return pathname;
  }
  return null;
}

export function defaultHeadline(festivalName: string): string {
  return `Warm wishes on ${festivalName}`;
}
