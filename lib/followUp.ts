// Pure helpers shared between server (API routes) and client (history table) —
// no fs/blob imports here so this can run in 'use client' components too.

export const FOLLOW_UP_DAYS = 3;

export interface FollowUpNote {
  at: string;
  by: string;
  note: string;
}

export function parseFollowUpNotes(json: string | undefined): FollowUpNote[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function needsFollowUp(
  record: { created_at: string; last_follow_up_at?: string },
  days: number = FOLLOW_UP_DAYS
): boolean {
  const anchor = record.last_follow_up_at || record.created_at;
  if (!anchor) return false;
  const anchorTime = new Date(anchor).getTime();
  if (Number.isNaN(anchorTime)) return false;
  const ageMs = Date.now() - anchorTime;
  return ageMs >= days * 24 * 60 * 60 * 1000;
}

export function daysSince(iso: string): number {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return 0;
  return Math.floor((Date.now() - time) / (24 * 60 * 60 * 1000));
}
