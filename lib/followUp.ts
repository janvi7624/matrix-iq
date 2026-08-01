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

// A lead is "unattended" once it's sat with no follow-up action recorded for
// longer than the SLA above — backs the Dashboard's "Unattended Leads" KPI
// card and the matching filter on the Lead Capture list. Shared here (rather
// than in lib/leadStore.ts) so both the server-side stats route and the
// client-side list filter use the exact same definition.
export function isLeadUnattended(lead: { follow_up_actions: string[]; created_at: string }): boolean {
  return lead.follow_up_actions.length === 0 && daysSince(lead.created_at) >= FOLLOW_UP_DAYS;
}
