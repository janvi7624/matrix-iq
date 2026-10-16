import { Op } from 'sequelize';
import { db } from './db';
import { istInstant, addDays } from './dailyReportTime';
import { resolveQuotationOwner, fetchNameToId } from './salesAchievement';

// Auto-fetched cells for the Sales / GEM-Sales daily report matrix — see
// SALES_TEMPLATE.autoMeasures in lib/dailyReportTemplates.ts for which
// measures this covers (New Leads Generated, Quotations Prepared,
// Quotations Sent, Purchase Orders Received) and why the other 4 (Customer
// Calls, Meetings Completed, Meetings Scheduled, Follow-ups Completed) stay
// manual: this app has no call/meeting log anywhere else to read from.
//
// "Channel" (AI / AV / Robotics, or whatever a department's template
// override says) is resolved the SAME way everywhere else in this app
// already resolves a product vertical — never from
// Quotation.project_vertical, which is an INDUSTRY vertical (Corporate,
// Healthcare, ...), a different field entirely:
//   - a Lead's own `interests` (DomainKey[], lowercase 'ai'/'av'/'robotics')
//   - a Quotation's LINKED PROJECT's `departments` (same DomainKey[] shape)
// A record naming more than one channel (a lead interested in both AI and
// AV, a project spanning two departments) counts toward each — the same
// "one activity, multiple verticals" rule Project.departments already uses
// for revenue splitting (department_amounts).
//
// `channels` and `autoMeasures` are passed in by the caller (the resolved
// TemplateDefinition for the employee's department) rather than imported as
// the raw SALES_CHANNELS/SALES_MEASURES constants, so a department-level
// admin override of the channel list (lib/dailyReportTemplateStore.ts's
// resolveTemplate) is honoured here exactly as it is everywhere else the
// template is used — hardcoding the constants would silently ignore an
// override and then overwrite whatever the override's channels actually are
// with zeros on the next save.

export type SalesAutoMatrix = Record<string, Record<string, number>>;

function buildChannelMap(channels: string[]): Record<string, string> {
  return Object.fromEntries(channels.map((c) => [c.toLowerCase(), c]));
}

function emptyMatrix(autoMeasures: string[], channels: string[]): SalesAutoMatrix {
  const m: SalesAutoMatrix = {};
  // Only the auto measures — NOT every measure in the template. A manual
  // measure (Customer Calls, Meetings...) must never appear in this
  // object: mergeAutoMatrix overlays every key this object has, so an
  // entry here for a manual measure would silently zero out whatever the
  // employee had already typed for it on every save.
  for (const measure of autoMeasures) {
    m[measure] = {};
    for (const channel of channels) m[measure][channel] = 0;
  }
  return m;
}

function bump(matrix: SalesAutoMatrix, measure: string, channel: string, by = 1) {
  if (!matrix[measure]) return;
  matrix[measure][channel] = (matrix[measure][channel] ?? 0) + by;
}

/**
 * The auto-fetched slice of one employee's matrix for one IST calendar day.
 * Only ever touches `autoMeasures` — callers merge this OVER an existing
 * draft's matrix so the manual measures (whatever the employee already
 * typed) are left untouched.
 *
 * `autoMeasures` and `channels` come from the employee's RESOLVED template
 * (resolveTemplateForDepartment), so a department-level override of the
 * channel list is respected rather than hardcoded.
 */
export async function computeSalesAutoMatrix(
  employeeId: string,
  reportDate: string,
  autoMeasures: string[],
  channels: string[]
): Promise<SalesAutoMatrix> {
  const dayStart = istInstant(reportDate, '00:00');
  const dayEnd = istInstant(addDays(reportDate, 1), '00:00');
  const matrix = emptyMatrix(autoMeasures, channels);
  if (!autoMeasures.length || !channels.length) return matrix;

  const domainToChannel = buildChannelMap(channels);
  const wants = (measure: string) => autoMeasures.includes(measure);

  const [leads, preparedToday, approvedToday, nameToId] = await Promise.all([
    wants('New Leads Generated')
      ? db.Lead.findAll({
          where: { created_by: employeeId, created_at: { [Op.gte]: dayStart, [Op.lt]: dayEnd } } as never,
          attributes: ['interests']
        })
      : Promise.resolve([]),
    // "Prepared" / "Sent": quotations CREATED today — same-day activity.
    wants('Quotations Prepared') || wants('Quotations Sent')
      ? db.Quotation.findAll({
          where: { created_at: { [Op.gte]: dayStart, [Op.lt]: dayEnd } } as never,
          include: [{ model: db.Project, as: 'project', attributes: ['departments'] }] as never,
          attributes: ['created_by', 'prepared_by', 'prepared_by_user_id', 'status']
        })
      : Promise.resolve([]),
    // "Purchase Orders Received": approved TODAY, regardless of when the
    // quotation was originally created — a separate query keyed on
    // status_changed_at, not a re-filter of the "created today" set above.
    // A quote-to-approval cycle spanning several days (the normal case for
    // this app's project sales, not an edge case) would otherwise make this
    // cell read zero on the very day the PO actually arrived.
    wants('Purchase Orders Received')
      ? db.Quotation.findAll({
          where: { status: 'approved', status_changed_at: { [Op.gte]: dayStart, [Op.lt]: dayEnd } } as never,
          include: [{ model: db.Project, as: 'project', attributes: ['departments'] }] as never,
          attributes: ['created_by', 'prepared_by', 'prepared_by_user_id', 'status']
        })
      : Promise.resolve([]),
    fetchNameToId()
  ]);

  for (const lead of leads) {
    const interests = (lead.get('interests') as string[] | null) ?? [];
    for (const domain of interests) {
      const channel = domainToChannel[domain.toLowerCase()];
      if (channel) bump(matrix, 'New Leads Generated', channel);
    }
  }

  const channelsFor = (quotation: Record<string, unknown>): string[] => {
    const departments = ((quotation.project as { departments?: string[] } | null)?.departments ?? []) as string[];
    return departments.map((d) => domainToChannel[d.toLowerCase()]).filter((c): c is string => !!c);
  };

  for (const quotation of preparedToday) {
    const plain = quotation.get({ plain: true }) as Record<string, unknown>;
    if (resolveQuotationOwner(plain, nameToId) !== employeeId) continue;
    const channels2 = channelsFor(plain);
    // No linked project, or none of its departments are tracked channels —
    // still real activity, just with nowhere in this grid to attribute it.
    // See the module's own known-limitations note; not silently treated as
    // "no activity happened" by anything that reads the OVERALL total (the
    // 2-zero-day warning sums auto cells, not quotation counts).
    if (!channels2.length) continue;
    for (const channel of channels2) {
      if (wants('Quotations Prepared')) bump(matrix, 'Quotations Prepared', channel);
      if (wants('Quotations Sent') && plain.status !== 'draft') bump(matrix, 'Quotations Sent', channel);
    }
  }

  for (const quotation of approvedToday) {
    const plain = quotation.get({ plain: true }) as Record<string, unknown>;
    if (resolveQuotationOwner(plain, nameToId) !== employeeId) continue;
    const channels2 = channelsFor(plain);
    if (!channels2.length) continue;
    for (const channel of channels2) bump(matrix, 'Purchase Orders Received', channel);
  }

  return matrix;
}

/** Merges the auto matrix OVER an existing matrix — auto cells always win (they're
 *  re-derived fresh every time), every other cell (the manual measures) passes through untouched. */
export function mergeAutoMatrix(existing: Record<string, Record<string, number>> | null | undefined, auto: SalesAutoMatrix): Record<string, Record<string, number>> {
  const merged: Record<string, Record<string, number>> = { ...(existing ?? {}) };
  for (const measure of Object.keys(auto)) {
    merged[measure] = { ...(merged[measure] ?? {}), ...auto[measure] };
  }
  return merged;
}
