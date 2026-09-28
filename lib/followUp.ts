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

// A lead is "unattended" when it has been handed to somebody and they haven't
// called it within the SLA. Backs the Dashboard's "Unattended Leads" item, the
// Lead Capture tile/filter and the sidebar badge — shared here so the
// server-side stats and the client-side filter can't drift apart.
//
// It used to read `follow_up_actions.length === 0 && age(created_at) >= SLA`,
// which no action in the product could ever clear: assigning a lead doesn't
// touch follow_up_actions, and those chips are intentions picked at capture
// time ("Call in 3 days"), not work done. On live data every single flagged
// lead was already assigned AND already converted to a project, and the alert
// still wouldn't go away. Now the clock is an actual event:
//   - not assigned to anyone -> not this alert's job (that's the "To Assign"
//     queue; nobody has been asked to do anything yet)
//   - already a project, or called and ruled out -> finished, never flagged
//   - otherwise: time since the last real event — the promised call-back, the
//     last call, or the assignment — measured against the SLA.
export function isLeadUnattended(lead: {
  follow_up_actions: string[];
  created_at: string;
  assigned_to_id?: string;
  assigned_at?: string;
  project_id?: string;
  call_outcome?: string;
  called_at?: string;
  callback_at?: string;
}): boolean {
  if (!lead.assigned_to_id) return false;
  if (lead.project_id) return false;
  if (lead.call_outcome === 'not_suitable' || lead.call_outcome === 'suitable') return false;
  // A promised call-back is its own deadline: overdue the day after it passes.
  if (lead.call_outcome === 'callback' && lead.callback_at) {
    return daysSince(`${lead.callback_at}T00:00:00`) > 0;
  }
  // The LATEST event, not the first one found: a lead called ten days ago and
  // reassigned today has to start from today, or its new owner is already in
  // breach the second it lands on them. Reassignment is routine here (manager
  // reassign, employee exit, capture-time hand-over), and after an expo it's
  // constant.
  const clock = [lead.called_at, lead.assigned_at, lead.created_at].filter(Boolean).sort().pop() as string;
  return daysSince(clock) >= FOLLOW_UP_DAYS;
}
