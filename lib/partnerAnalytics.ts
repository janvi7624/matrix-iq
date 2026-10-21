import { Op } from 'sequelize';
import { db, isUuid } from './db';
import {
  AnalyticsDemoRow,
  AnalyticsProjectRow,
  DepartmentBreakdownPoint,
  MonthlyPoint,
  PartnerKpis,
  computeDepartmentBreakdown,
  computeMonthlyTrend,
  computePartnerKpis
} from './partnerAnalyticsCompute';

// Fetches the rows partner analytics is computed from. All arithmetic lives
// in lib/partnerAnalyticsCompute.ts (pure, tested); this file only queries.

export interface PartnerAnalytics {
  kpis: PartnerKpis;
  monthly: MonthlyPoint[];
  departments: DepartmentBreakdownPoint[];
}

const MONTHS_BACK = 12;

function toProjectRow(plain: Record<string, unknown>): AnalyticsProjectRow {
  return {
    id: plain.id as string,
    partner_submission_status: (plain.partner_submission_status as string) ?? '',
    status: (plain.status as string) ?? '',
    stage: (plain.stage as string) ?? '',
    departments: Array.isArray(plain.departments) ? (plain.departments as string[]) : [],
    // node-postgres returns DECIMAL as a string to preserve precision — the
    // same coercion lib/projectStore.ts documents. Without it every sum here
    // would concatenate strings instead of adding numbers.
    partner_submitted_value: plain.partner_submitted_value === null || plain.partner_submitted_value === undefined ? '' : Number(plain.partner_submitted_value),
    approx_price: plain.approx_price === null || plain.approx_price === undefined ? '' : Number(plain.approx_price),
    created_at: plain.createdAt instanceof Date ? plain.createdAt.toISOString() : String(plain.createdAt ?? '')
  };
}

/**
 * Everything one partner may see about their own performance.
 *
 * partner_id is in every WHERE — a partner's analytics must be computed from
 * their rows alone, never from a wider set filtered afterwards.
 */
export async function getPartnerAnalytics(partnerId: string, now: Date = new Date()): Promise<PartnerAnalytics> {
  if (!isUuid(partnerId)) {
    return { kpis: computePartnerKpis([], [], 0), monthly: computeMonthlyTrend([], MONTHS_BACK, now), departments: [] };
  }

  const [projectRows, demoRows, quotationsShared] = await Promise.all([
    db.Project.findAll({
      where: { partner_id: partnerId } as never,
      attributes: ['id', 'partner_submission_status', 'status', 'stage', 'departments', 'partner_submitted_value', 'approx_price', 'created_at']
    }),
    db.DemoSchedule.findAll({
      where: { partner_id: partnerId } as never,
      attributes: ['id', 'status', 'created_at']
    }),
    db.PartnerQuotationShare.count({ where: { partner_id: partnerId, revoked_at: null } as never })
  ]);

  const projects = projectRows.map((r) => toProjectRow(r.get({ plain: true }) as Record<string, unknown>));
  const demos: AnalyticsDemoRow[] = demoRows.map((r) => {
    const plain = r.get({ plain: true }) as Record<string, unknown>;
    return {
      id: plain.id as string,
      status: (plain.status as string) ?? '',
      created_at: plain.createdAt instanceof Date ? plain.createdAt.toISOString() : String(plain.createdAt ?? '')
    };
  });

  return {
    kpis: computePartnerKpis(projects, demos, quotationsShared),
    monthly: computeMonthlyTrend(projects, MONTHS_BACK, now),
    departments: computeDepartmentBreakdown(projects)
  };
}

export interface PartnerComparisonRow {
  partnerId: string;
  partnerCode: string;
  companyName: string;
  status: string;
  relationshipManager: string;
  kpis: PartnerKpis;
}

/**
 * The internal consolidated view — every partner side by side.
 *
 * Reads all partner projects and demos in two queries and groups in memory,
 * rather than running getPartnerAnalytics per partner. With N partners the
 * per-partner approach is 3N queries; this is 3 regardless, and the row
 * counts here are small (partner-sourced projects are a minority of the
 * projects table, which is itself a few hundred rows).
 */
export async function getPartnerComparison(now: Date = new Date()): Promise<PartnerComparisonRow[]> {
  const [partners, projectRows, demoRows, shareRows] = await Promise.all([
    db.Partner.findAll({ include: [{ model: db.User, as: 'relationshipManager', attributes: ['name', 'username'] }] }),
    db.Project.findAll({
      where: { partner_id: { [Op.ne]: null } } as never,
      attributes: ['id', 'partner_id', 'partner_submission_status', 'status', 'stage', 'departments', 'partner_submitted_value', 'approx_price', 'created_at']
    }),
    db.DemoSchedule.findAll({ attributes: ['id', 'partner_id', 'status', 'created_at'] }),
    db.PartnerQuotationShare.findAll({ where: { revoked_at: null } as never, attributes: ['partner_id'] })
  ]);

  const projectsByPartner = new Map<string, AnalyticsProjectRow[]>();
  for (const row of projectRows) {
    const plain = row.get({ plain: true }) as Record<string, unknown>;
    const partnerId = plain.partner_id as string | null;
    if (!partnerId) continue;
    const list = projectsByPartner.get(partnerId) ?? [];
    list.push(toProjectRow(plain));
    projectsByPartner.set(partnerId, list);
  }

  const demosByPartner = new Map<string, AnalyticsDemoRow[]>();
  for (const row of demoRows) {
    const plain = row.get({ plain: true }) as Record<string, unknown>;
    const partnerId = plain.partner_id as string | null;
    if (!partnerId) continue;
    const list = demosByPartner.get(partnerId) ?? [];
    list.push({
      id: plain.id as string,
      status: (plain.status as string) ?? '',
      created_at: plain.createdAt instanceof Date ? plain.createdAt.toISOString() : String(plain.createdAt ?? '')
    });
    demosByPartner.set(partnerId, list);
  }

  const sharesByPartner = new Map<string, number>();
  for (const row of shareRows) {
    const partnerId = row.get('partner_id') as string;
    sharesByPartner.set(partnerId, (sharesByPartner.get(partnerId) ?? 0) + 1);
  }

  void now;
  return partners.map((row) => {
    const plain = row.get({ plain: true }) as Record<string, unknown>;
    const id = plain.id as string;
    const rm = plain.relationshipManager as { name?: string; username?: string } | null;
    return {
      partnerId: id,
      partnerCode: (plain.partner_code as string) ?? '',
      companyName: (plain.company_name as string) ?? '',
      status: (plain.status as string) ?? '',
      relationshipManager: rm?.name || rm?.username || '',
      kpis: computePartnerKpis(projectsByPartner.get(id) ?? [], demosByPartner.get(id) ?? [], sharesByPartner.get(id) ?? 0)
    };
  });
}
