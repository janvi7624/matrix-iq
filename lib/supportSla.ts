// Response and resolution targets, and whether a ticket has missed them.
//
// Pure, no imports — and the central design decision is that BREACH IS
// COMPUTED, NEVER STORED. A stored `is_breached` flag has to be recomputed
// by something whenever a policy changes, a ticket moves, or the clock
// simply passes a threshold with nobody touching the row — and this app has
// no background job to do that. A stored flag would therefore be wrong most
// of the time, in the silent direction: tickets that have breached still
// showing green.
//
// The due TIMESTAMPS are stored (stamped at triage) because they are a
// commitment made at a point in time; re-deriving them later from a policy
// that has since been edited would retroactively change what we promised.
// The judgement about whether we met them is always recomputed from those
// timestamps plus the status history.

export interface SlaPolicy {
  priority: string;
  firstResponseMinutes: number;
  resolutionMinutes: number;
  pauseOnAwaitingPartner: boolean;
  businessHoursOnly: boolean;
  escalateAfterMinutes: number | null;
}

export interface StatusHistoryEntry {
  from_status: string | null;
  to_status: string;
  at: string;
}

export interface SlaInput {
  createdAt: string;
  /** Stamped at triage. '' when the ticket has not been triaged yet. */
  responseDueAt: string;
  resolutionDueAt: string;
  firstResponseAt: string;
  resolvedAt: string;
  closedAt: string;
  status: string;
  history: StatusHistoryEntry[];
  policy: SlaPolicy | null;
}

export type SlaState = 'not_started' | 'on_track' | 'due_soon' | 'breached' | 'met';

export interface SlaAssessment {
  responseState: SlaState;
  resolutionState: SlaState;
  /** Milliseconds the clock was stopped awaiting the partner. */
  pausedMs: number;
  /** Resolution due date shifted by paused time — the date actually judged against. */
  effectiveResolutionDueAt: string;
  /** Null when there is no due date, or the ticket is already resolved. */
  minutesRemaining: number | null;
  breached: boolean;
}

/** Inside this window before the deadline, a ticket is "due soon" rather than merely on track. */
const DUE_SOON_MINUTES = 60;

const PAUSED_STATUS = 'awaiting_partner';

function ms(value: string): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * How long the ticket sat in `awaiting_partner`.
 *
 * Walked from the status history rather than accumulated into a column,
 * because a counter would have to be updated on every transition and would
 * drift the first time one path forgot to. The history is append-only and
 * cannot disagree with itself.
 *
 * An unclosed pause (the ticket is awaiting the partner right now) counts up
 * to `now` — otherwise a ticket parked on the customer would quietly breach
 * while the clock was supposed to be stopped.
 */
export function computePausedMs(history: StatusHistoryEntry[], currentStatus: string, now: Date): number {
  const ordered = [...history].sort((a, b) => (a.at < b.at ? -1 : 1));
  let paused = 0;
  let pauseStart: number | null = null;

  for (const entry of ordered) {
    const at = ms(entry.at);
    if (at === null) continue;
    if (entry.to_status === PAUSED_STATUS) {
      // Re-entering while already paused would double count; keep the first.
      if (pauseStart === null) pauseStart = at;
    } else if (pauseStart !== null) {
      paused += at - pauseStart;
      pauseStart = null;
    }
  }

  if (pauseStart !== null && currentStatus === PAUSED_STATUS) {
    paused += now.getTime() - pauseStart;
  }
  return Math.max(0, paused);
}

function stateFor(dueAt: number | null, metAt: number | null, now: number): SlaState {
  if (dueAt === null) return 'not_started';
  if (metAt !== null) return metAt <= dueAt ? 'met' : 'breached';
  if (now > dueAt) return 'breached';
  if (dueAt - now <= DUE_SOON_MINUTES * 60_000) return 'due_soon';
  return 'on_track';
}

export function assessSla(input: SlaInput, now: Date = new Date()): SlaAssessment {
  const nowMs = now.getTime();
  const pausedMs = input.policy?.pauseOnAwaitingPartner
    ? computePausedMs(input.history, input.status, now)
    : 0;

  const responseDue = ms(input.responseDueAt);
  const resolutionDue = ms(input.resolutionDueAt);
  // The pause shifts the deadline forward by however long we were waiting.
  const effectiveResolutionDue = resolutionDue === null ? null : resolutionDue + pausedMs;

  const firstResponse = ms(input.firstResponseAt);
  // A closed ticket is judged on when it was RESOLVED, not closed — closure
  // often waits on the customer confirming, which is not our delay.
  const resolved = ms(input.resolvedAt) ?? ms(input.closedAt);

  const responseState = stateFor(responseDue, firstResponse, nowMs);
  const resolutionState = stateFor(effectiveResolutionDue, resolved, nowMs);

  return {
    responseState,
    resolutionState,
    pausedMs,
    effectiveResolutionDueAt: effectiveResolutionDue === null ? '' : new Date(effectiveResolutionDue).toISOString(),
    minutesRemaining:
      effectiveResolutionDue === null || resolved !== null ? null : Math.round((effectiveResolutionDue - nowMs) / 60_000),
    breached: responseState === 'breached' || resolutionState === 'breached'
  };
}

/**
 * The due dates to stamp when a ticket is triaged.
 *
 * Measured from the ticket's CREATION, not from triage — the customer's
 * clock started when they reported the problem, and measuring from the
 * moment we got round to looking at it would let a slow triage erase its own
 * delay.
 */
export function computeDueDates(createdAt: string, policy: SlaPolicy | null): { responseDueAt: string; resolutionDueAt: string } {
  const created = ms(createdAt);
  if (!policy || created === null) return { responseDueAt: '', resolutionDueAt: '' };
  return {
    responseDueAt: new Date(created + policy.firstResponseMinutes * 60_000).toISOString(),
    resolutionDueAt: new Date(created + policy.resolutionMinutes * 60_000).toISOString()
  };
}

/** Should this ticket be escalated on time alone? */
export function shouldAutoEscalate(input: SlaInput, now: Date = new Date()): boolean {
  if (!input.policy?.escalateAfterMinutes) return false;
  if (input.resolvedAt || input.closedAt) return false;
  if (input.status === 'escalated') return false;
  const created = ms(input.createdAt);
  if (created === null) return false;
  const pausedMs = input.policy.pauseOnAwaitingPartner ? computePausedMs(input.history, input.status, now) : 0;
  return now.getTime() - created - pausedMs > input.policy.escalateAfterMinutes * 60_000;
}

export function formatDuration(msValue: number): string {
  if (msValue <= 0) return '0m';
  const minutes = Math.floor(msValue / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}
