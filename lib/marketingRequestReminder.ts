// Pure helpers, no fs/db imports — safe in both server API routes and
// 'use client' components, same shape as lib/followUp.ts's needsFollowUp
// and lib/siteVisitReminder.ts's isReminderDue. No stored "reminder" row;
// the band is always derived live from the request's target date + status.

import { MarketingRequestRecord } from './types';
import { isMarketingRequestOverdue } from './marketingRequestHelpers';

export type MarketingReminderBand = 'upcoming' | 'due_soon' | 'due_today' | 'overdue' | 'none';

type ReminderInput = Pick<MarketingRequestRecord, 'timeline' | 'needed_by_date' | 'status'>;

// Single definition of "still open" for a marketing request — moved here
// from what used to be a local, unexported duplicate
// (NON_FINAL_STATUSES in app/api/marketing-requests/stats/route.ts) used for
// that route's myOpenCount. Deliberately separate from the narrower
// terminal-status check inside isMarketingRequestOverdue below (that one
// excludes only completed/rejected/cancelled, not 'approved') — the two
// already meant different things before this file existed and aren't
// merged here to avoid silently changing either's behavior.
const OPEN_STATUSES = new Set([
  'submitted',
  'marketing_in_progress',
  'pending_technical_review',
  'technical_approved',
  'tech_changes_requested',
  'marketing_final_review',
  'waiting_info',
  'ready_for_review',
  'timeline_set',
  'in_progress'
]);

export function isMarketingRequestOpen(status: string): boolean {
  return OPEN_STATUSES.has(status);
}

// The date a reminder should count down to — the marketing team's own
// committed delivery date once one is set, falling back to the requester's
// original ask. Matches isMarketingRequestOverdue's exact resolution below,
// so the two never disagree about which date is "the" due date.
function targetDate(record: ReminderInput): string {
  return record.timeline?.expectedDeliveryDate || record.needed_by_date;
}

function daysUntil(dateOnly: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dateOnly);
  due.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}

// Builds on the existing isMarketingRequestOverdue (already shipped, already
// driving the "Overdue" pill on each table row) rather than reinventing
// overdue detection — 'overdue' here is defined to always agree with that
// function, so a request can never show as overdue in one place and not
// the other.
export function marketingReminderBand(record: ReminderInput): MarketingReminderBand {
  if (isMarketingRequestOverdue(record)) return 'overdue';
  if (record.status === 'completed' || record.status === 'rejected' || record.status === 'cancelled') return 'none';
  const due = targetDate(record);
  if (!due) return 'none';
  const diffDays = daysUntil(due);
  if (diffDays === 0) return 'due_today';
  if (diffDays <= 2) return 'due_soon';
  return 'upcoming';
}

// Only meaningful when the band is 'overdue' — how many days past the target date.
export function daysOverdue(record: ReminderInput): number {
  if (marketingReminderBand(record) !== 'overdue') return 0;
  return Math.abs(daysUntil(targetDate(record)));
}

export interface MarketingReminderBreakdown {
  upcoming: number;
  due_soon: number;
  due_today: number;
  overdue: number;
}

export function summarizeMarketingReminders(records: ReminderInput[]): MarketingReminderBreakdown {
  const breakdown: MarketingReminderBreakdown = { upcoming: 0, due_soon: 0, due_today: 0, overdue: 0 };
  for (const r of records) {
    const band = marketingReminderBand(r);
    if (band !== 'none') breakdown[band]++;
  }
  return breakdown;
}
