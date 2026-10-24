import { Op } from 'sequelize';
import { db } from './db';
import { addDays, istInstant } from './dailyReportTime';

// The call half of the Sales / GEM-Sales daily report matrix: "Customer Calls"
// and "Follow-ups Completed", read from the qualification call a rep logs on a
// lead (Leads -> Log Call, lib/leadCall.ts).
//
// Kept out of lib/salesDailyAutoFetch.ts, which owns the four Quotation/Lead
// measures, purely so the two sources stay separately readable — that module
// calls into this one for these two measures and merges the result.
//
// WHAT THE SOURCE CAN AND CANNOT SAY. A logged call is not a history: it is
// five mutable columns on the lead row itself (call_outcome, called_at,
// called_by_id, call_remark, callback_at — see the 20260xx lead-call
// migration), so a lead keeps only its MOST RECENT call. Two consequences,
// both deliberate rather than overlooked:
//
//   1. Two calls to the same lead on the same day count once. There is no
//      second row to count, and inventing one would be a guess.
//   2. A past day's figure cannot drift, even though the underlying column
//      can be overwritten later — because lib/dailyReportService.ts only
//      re-derives auto measures while the day is still a draft
//      (`if (!submitted && ...)`), and lib/dailyReportStore.ts freezes the
//      computed value into the stored matrix on save and submit. A submitted
//      report keeps the number it was submitted with.
//
// If per-call history is ever wanted (a rep who rings one lead four times in
// a day showing as 4), that needs a lead_calls table written by
// lib/leadCall.ts — not a change here.

/** The two measures this module can answer for. */
export const LEAD_CALL_MEASURES = ['Customer Calls', 'Follow-ups Completed'] as const;

// Which outcome counts as a follow-up having been COMPLETED. 'completed' is
// lib/leadCall.ts's own term for a call that resolved the matter without being
// a rejection — the one outcome in LEAD_CALL_OUTCOMES that means the thread is
// finished rather than advanced ('suitable' opens a project, 'callback' defers,
// 'not_suitable' rejects). If the business means something else by the phrase,
// this constant is the single place to change it.
const FOLLOW_UP_COMPLETED_OUTCOME = 'completed';

export interface LeadCallDailyCounts {
  /** measure -> channel -> count */
  [measure: string]: Record<string, number>;
}

function channelMap(channels: string[]): Record<string, string> {
  return Object.fromEntries(channels.map((c) => [c.toLowerCase(), c]));
}

interface CalledLead {
  id: string;
  name: string;
  company: string;
  outcome: string;
  interests: string[];
}

/**
 * Every lead this employee logged a call on during one IST calendar day.
 *
 * Shared by the counting and the drill-down paths below so the number and the
 * list behind it can never disagree — unlike the four measures in
 * salesDailyAutoFetch, where the two paths are deliberately separate because
 * their queries differ in cost.
 */
async function loadCalledLeads(employeeId: string, reportDate: string): Promise<CalledLead[]> {
  const dayStart = istInstant(reportDate, '00:00');
  const dayEnd = istInstant(addDays(reportDate, 1), '00:00');
  const rows = await db.Lead.findAll({
    where: {
      called_by_id: employeeId,
      called_at: { [Op.gte]: dayStart, [Op.lt]: dayEnd }
    } as never,
    attributes: ['id', 'name', 'company', 'call_outcome', 'interests', 'called_at'],
    order: [['called_at', 'ASC']]
  });
  return rows.map((row) => {
    const plain = row.get({ plain: true }) as Record<string, unknown>;
    return {
      id: String(plain.id),
      name: String(plain.name ?? ''),
      company: String(plain.company ?? ''),
      outcome: String(plain.call_outcome ?? ''),
      interests: ((plain.interests as string[] | null) ?? []).map(String)
    };
  });
}

function countsFor(leads: CalledLead[], channels: string[]): LeadCallDailyCounts {
  const byChannel = channelMap(channels);
  const out: LeadCallDailyCounts = {};
  for (const measure of LEAD_CALL_MEASURES) {
    out[measure] = {};
    for (const channel of channels) out[measure][channel] = 0;
  }

  for (const lead of leads) {
    // A lead interested in both AI and AV counts toward each — the same
    // "one activity, several verticals" rule New Leads Generated already uses,
    // and the one Project.departments uses for revenue splitting.
    const matched = lead.interests
      .map((interest) => byChannel[interest.toLowerCase()])
      .filter((channel): channel is string => !!channel);
    for (const channel of new Set(matched)) {
      out['Customer Calls'][channel] += 1;
      if (lead.outcome === FOLLOW_UP_COMPLETED_OUTCOME) out['Follow-ups Completed'][channel] += 1;
    }
  }
  return out;
}

/**
 * Customer Calls and Follow-ups Completed for one employee, one IST day,
 * broken down by the template's channels.
 *
 * `wanted` is the caller's autoMeasures list: a measure absent from it is
 * absent from the result, so a department whose template override leaves one
 * of these manual keeps whatever the employee typed. Returning a zero for it
 * would overwrite that on the next save.
 */
export async function computeLeadCallCounts(
  employeeId: string,
  reportDate: string,
  wanted: string[],
  channels: string[]
): Promise<LeadCallDailyCounts> {
  const measures = LEAD_CALL_MEASURES.filter((m) => wanted.includes(m));
  if (!measures.length || !channels.length) return {};

  const leads = await loadCalledLeads(employeeId, reportDate);
  const all = countsFor(leads, channels);
  return Object.fromEntries(measures.map((m) => [m, all[m]]));
}

export interface LeadCallDetailItem {
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

/** The leads behind one of these two cells, for the click-through list. */
export async function fetchLeadCallDetail(
  employeeId: string,
  reportDate: string,
  measure: string,
  channel: string
): Promise<LeadCallDetailItem[]> {
  if (!(LEAD_CALL_MEASURES as readonly string[]).includes(measure)) return [];
  const wantedChannel = channel.toLowerCase();
  const leads = await loadCalledLeads(employeeId, reportDate);

  return leads
    .filter((lead) => lead.interests.some((interest) => interest.toLowerCase() === wantedChannel))
    .filter((lead) => measure !== 'Follow-ups Completed' || lead.outcome === FOLLOW_UP_COMPLETED_OUTCOME)
    .map((lead) => ({
      id: lead.id,
      title: lead.name || lead.company || 'Unnamed lead',
      subtitle: [lead.company, lead.outcome ? `call: ${lead.outcome.replace(/_/g, ' ')}` : '']
        .filter(Boolean)
        .join(' · '),
      // No per-lead detail route exists, the same reason New Leads Generated
      // links to the list: a lead is found there by name or company.
      href: '/leads'
    }));
}
