import { Op } from 'sequelize';
import { db } from './db';

export const TECHNICAL_DOMAIN_DEPARTMENTS = [
  'Technical',
  'Engineering',
  'AV',
  'Robotics',
  'AI',
  'CCTV',
  'IoT',
  'Networking',
  'System Integration',
  'VisitIQ',
  'VMS',
  'Software'
];

export interface TechnicalRosterEntry {
  id: string;
  username: string;
  name: string;
  department: string;
  role?: string;
  pendingTasksCount?: number;
  activeMarketingReviews?: number;
  activeDemos?: number;
  activeProjects?: number;
  isRecommended?: boolean;
  categoryMatched?: boolean;
}

export function isExactDepartmentMatch(userDept: string, category: string): boolean {
  const d = (userDept || '').trim().toLowerCase();
  const dWords = d.split(/[\s/&,-]+/).filter(Boolean);

  if (category === 'AV') {
    return d === 'av' || dWords.includes('av') || d.includes('audio') || d.includes('visual');
  }
  if (category === 'Robotics') {
    return d === 'robotics' || dWords.includes('robotics') || dWords.includes('robot') || d.includes('automation');
  }
  if (category.startsWith('AI Video Analytics') || category === 'AI Video Analytics') {
    return d === 'ai' || dWords.includes('ai') || d.includes('video') || d.includes('analytic') || d.includes('vms') || d.includes('vision');
  }
  if (category === 'System Integration') {
    return d.includes('system') || d.includes('integration') || dWords.includes('si') || d.includes('network') || d.includes('cctv') || d.includes('iot') || d === 'technical' || d === 'engineering';
  }
  if (category.startsWith('VisitIQ') || category === 'VisitIQ VMS') {
    return d.includes('visitiq') || d.includes('visitor') || d.includes('vms') || d.includes('software') || d === 'ai' || dWords.includes('ai') || d === 'technical';
  }
  return false;
}

export async function listTechnicalRoster(options?: { category?: string }): Promise<TechnicalRosterEntry[]> {
  // 1. Fetch all active users with their role and department
  const rows = await db.User.findAll({
    where: { status: 'active' } as never,
    include: [
      { model: db.Role, as: 'role', attributes: ['id', 'key', 'label'] },
      { model: db.Department, as: 'departmentRef', attributes: ['id', 'name'] }
    ],
    order: [['name', 'ASC']]
  });

  const allUsers: TechnicalRosterEntry[] = rows.map((row) => {
    const plain = row.get({ plain: true }) as Record<string, unknown>;
    const roleObj = plain.role as { key?: string; label?: string } | null;
    const deptObj = plain.departmentRef as { name?: string } | null;
    return {
      id: plain.id as string,
      username: plain.username as string,
      name: (plain.name as string) || (plain.username as string),
      department: deptObj?.name ?? (plain.department as string) ?? '',
      role: roleObj?.key ?? ''
    };
  });

  // Filter for users who are in the engineer role OR technical/engineering/product departments
  const technicalUsers = allUsers.filter((u) => {
    const role = (u.role || '').toLowerCase();
    const dept = (u.department || '').toLowerCase();
    return (
      role === 'engineer' ||
      role === 'superadmin' ||
      TECHNICAL_DOMAIN_DEPARTMENTS.some((d) => dept.includes(d.toLowerCase()))
    );
  });

  // Base pool is technicalUsers if available, otherwise all users
  const basePool = technicalUsers.length > 0 ? technicalUsers : allUsers;

  // 2. Count Pending Tasks across Marketing Requests, Demos, and Projects for each user in basePool
  const userIds = basePool.map((u) => u.id);

  // a) Active Marketing reviews
  const marketingCounts: Record<string, number> = {};
  if (db.MarketingRequest && userIds.length > 0) {
    try {
      const marketingRows = await db.MarketingRequest.findAll({
        attributes: ['technical_assigned_to_id'],
        where: {
          technical_assigned_to_id: { [Op.in]: userIds },
          status: { [Op.in]: ['pending_technical_review', 'marketing_in_progress', 'tech_changes_requested', 'submitted'] }
        } as never,
        raw: true
      });
      for (const r of marketingRows as unknown as { technical_assigned_to_id: string }[]) {
        if (r.technical_assigned_to_id) {
          marketingCounts[r.technical_assigned_to_id] = (marketingCounts[r.technical_assigned_to_id] || 0) + 1;
        }
      }
    } catch {
      // Ignore count error if table not ready
    }
  }

  // b) Active Demos
  const demoCounts: Record<string, number> = {};
  if (db.DemoSchedule && userIds.length > 0) {
    try {
      const demoRows = await db.DemoSchedule.findAll({
        attributes: ['assigned_technical_person_id'],
        where: {
          assigned_technical_person_id: { [Op.in]: userIds },
          status: { [Op.in]: ['draft', 'pending_technical', 'pending_manager', 'pending_backoffice', 'dc_generated', 'material_dispatched'] }
        } as never,
        raw: true
      });
      for (const r of demoRows as unknown as { assigned_technical_person_id: string }[]) {
        if (r.assigned_technical_person_id) {
          demoCounts[r.assigned_technical_person_id] = (demoCounts[r.assigned_technical_person_id] || 0) + 1;
        }
      }
    } catch {
      // Ignore count error if table not ready
    }
  }

  // c) Active Projects
  const projectCounts: Record<string, number> = {};
  if (db.Project && userIds.length > 0) {
    try {
      const projectRows = await db.Project.findAll({
        attributes: ['assigned_technical_person_id'],
        where: {
          assigned_technical_person_id: { [Op.in]: userIds },
          stage: { [Op.in]: ['cold_call', 'catalogue_offered', 'site_visit', 'quotation', 'demo', 'customer_response', 'negotiation', 'po_received', 'installation'] }
        } as never,
        raw: true
      });
      for (const r of projectRows as unknown as { assigned_technical_person_id: string }[]) {
        if (r.assigned_technical_person_id) {
          projectCounts[r.assigned_technical_person_id] = (projectCounts[r.assigned_technical_person_id] || 0) + 1;
        }
      }
    } catch {
      // Ignore count error if table not ready
    }
  }

  // 3. Attach counts to all basePool users
  const enriched: TechnicalRosterEntry[] = basePool.map((u) => {
    const mCount = marketingCounts[u.id] || 0;
    const dCount = demoCounts[u.id] || 0;
    const pCount = projectCounts[u.id] || 0;
    const totalPending = mCount + dCount + pCount;
    return {
      ...u,
      activeMarketingReviews: mCount,
      activeDemos: dCount,
      activeProjects: pCount,
      pendingTasksCount: totalPending
    };
  });

  // 4. Product Category Matching & Prioritization
  const category = options?.category?.trim() || '';
  if (category) {
    const matched: TechnicalRosterEntry[] = [];
    const others: TechnicalRosterEntry[] = [];

    for (const u of enriched) {
      if (isExactDepartmentMatch(u.department, category)) {
        matched.push({ ...u, categoryMatched: true });
      } else {
        others.push({ ...u, categoryMatched: false });
      }
    }

    // Sort matched specialists by least pending tasks
    matched.sort((a, b) => {
      const diff = (a.pendingTasksCount || 0) - (b.pendingTasksCount || 0);
      if (diff !== 0) return diff;
      return a.name.localeCompare(b.name);
    });

    // Sort other technical members by least pending tasks
    others.sort((a, b) => {
      const diff = (a.pendingTasksCount || 0) - (b.pendingTasksCount || 0);
      if (diff !== 0) return diff;
      return a.name.localeCompare(b.name);
    });

    const minMatchedTasks = matched.length > 0 ? Math.min(...matched.map((u) => u.pendingTasksCount || 0)) : 0;
    const matchedEnriched = matched.map((u) => ({
      ...u,
      isRecommended: (u.pendingTasksCount || 0) === minMatchedTasks
    }));

    return [...matchedEnriched, ...others];
  }

  // If no category specified, sort everything by lowest pending tasks
  const minTasks = enriched.length > 0 ? Math.min(...enriched.map((u) => u.pendingTasksCount || 0)) : 0;
  enriched.sort((a, b) => {
    const diff = (a.pendingTasksCount || 0) - (b.pendingTasksCount || 0);
    if (diff !== 0) return diff;
    return a.name.localeCompare(b.name);
  });

  return enriched.map((u) => ({
    ...u,
    isRecommended: (u.pendingTasksCount || 0) === minTasks
  }));
}
