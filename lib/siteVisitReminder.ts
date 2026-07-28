// Pure helper shared between server (dashboard banner data) and client
// (site visit list) — no fs/blob imports so this can run in 'use client' too.
import { SiteVisitRecord } from './types';

export function isReminderDue(record: Pick<SiteVisitRecord, 'reminder_date' | 'status'>): boolean {
  if (record.status === 'closed' || !record.reminder_date) return false;
  const reminderTime = new Date(record.reminder_date).getTime();
  if (Number.isNaN(reminderTime)) return false;
  return reminderTime <= Date.now();
}

export const STAGE_LABEL: Record<'hot' | 'warm' | 'cold', string> = {
  hot: '🔥 Hot',
  warm: '♨️ Warm',
  cold: '🧊 Cold'
};

export const STAGE_HINT: Record<'hot' | 'warm' | 'cold', string> = {
  hot: 'Needs now — active requirement, ready to decide',
  warm: '1–3 months — evaluating, follow up soon',
  cold: 'Just exploring — nurture list, no urgency'
};
