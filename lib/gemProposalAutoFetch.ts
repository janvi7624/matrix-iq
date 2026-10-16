import { Op } from 'sequelize';
import { db } from './db';
import { istInstant, addDays } from './dailyReportTime';
import { resolveQuotationOwner, fetchNameToId } from './salesAchievement';

// GEM Sales' "Proposal Creation" rows — auto-generated from the employee's
// own real Quotation activity for the day, the rows-layout counterpart to
// lib/salesDailyAutoFetch.ts's matrix cells. "No manual entry" here means
// no manual entry: every field on one of these rows is set from the
// quotation, never typed, and the whole row is locked in the form
// (components/DailyReportForm.tsx).

const STATUS_TO_GEM_STATUS: Record<string, string> = {
  draft: 'In Progress',
  sent: 'Sent to Client',
  approved: 'Completed',
  rejected: 'Revision Required'
};

/**
 * One auto row per quotation the employee owns (resolveQuotationOwner —
 * the SAME attribution rule the Sales grid and achievement reports already
 * use) that was created on this IST calendar day.
 */
export async function computeGemProposalEntries(employeeId: string, employeeName: string, reportDate: string): Promise<Record<string, unknown>[]> {
  const dayStart = istInstant(reportDate, '00:00');
  const dayEnd = istInstant(addDays(reportDate, 1), '00:00');

  const [quotations, nameToId] = await Promise.all([
    db.Quotation.findAll({
      where: { created_at: { [Op.gte]: dayStart, [Op.lt]: dayEnd } } as never,
      attributes: ['id', 'quotation_number', 'created_by', 'prepared_by', 'prepared_by_user_id', 'status', 'client_name', 'client_company', 'total']
    }),
    fetchNameToId()
  ]);

  const entries: Record<string, unknown>[] = [];
  for (const quotation of quotations) {
    const plain = quotation.get({ plain: true }) as Record<string, unknown>;
    if (resolveQuotationOwner(plain, nameToId) !== employeeId) continue;

    const clientName = (plain.client_name as string) || (plain.client_company as string) || '';
    entries.push({
      gem_team_activity: 'Proposal Creation',
      client: clientName,
      project_value: String(Number(plain.total) || 0),
      sales_person: employeeName,
      current_status: STATUS_TO_GEM_STATUS[plain.status as string] ?? 'Not Started',
      activity_brief: `Quotation ${plain.quotation_number as string} prepared${clientName ? ` for ${clientName}` : ''}.`,
      proposal_quotation_id: plain.id
    });
  }
  return entries;
}

/**
 * Merges auto-generated Proposal Creation rows into an entries array,
 * matched by proposal_quotation_id.
 *
 * A row already present for that quotation is REPLACED with fresh values
 * (the quotation's status or total may have changed since the last save —
 * a locked row still has to stay accurate, not just exist once). A
 * quotation with no row yet gets one appended. Every other row — anything
 * with no proposal_quotation_id, i.e. every manually-added activity, of
 * Proposal Creation or any other kind — passes through completely
 * untouched; this never removes or reorders a row it did not itself create.
 */
export function mergeAutoGemEntries(existing: Record<string, unknown>[], auto: Record<string, unknown>[]): Record<string, unknown>[] {
  const byQuotationId = new Map(auto.map((entry) => [entry.proposal_quotation_id as string, entry]));
  const seen = new Set<string>();

  const merged = existing.map((entry) => {
    const quotationId = entry.proposal_quotation_id as string | undefined;
    if (quotationId && byQuotationId.has(quotationId)) {
      seen.add(quotationId);
      return byQuotationId.get(quotationId) as Record<string, unknown>;
    }
    return entry;
  });

  for (const entry of auto) {
    const quotationId = entry.proposal_quotation_id as string;
    if (!seen.has(quotationId)) merged.push(entry);
  }

  return merged;
}
