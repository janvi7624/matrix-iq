import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { resolveVisibilityScope } from '@/lib/departmentScope';
import { listActiveDepartments, departmentsManagedBy } from '@/lib/departmentStore';
import { findUserNameAndDeptByUsername } from '@/lib/userStore';
import { computeDepartmentScore, ScoringDataCache, TeamMember, ScoreResult } from '@/lib/departmentScoring';
import { apiErrorResponse } from '@/lib/apiError';
import { db } from '@/lib/db';

// Short, TTL-only cache of each department's own ScoreResult — deliberately
// NOT lib/memoCache.ts's cached(), which is reserved for reference data with
// an explicit invalidate() on every write path (see its own header comment).
// There is no single write path to hook for "every table department health
// reads from" — tms_tasks, tms_projects, quotations, reimbursements and more
// all feed it — so this is TTL-only on purpose. That is a safe tradeoff ONLY
// because the UI already tolerates exactly this staleness: Dashboard.tsx's
// useAutoRefresh polls this same endpoint every DEFAULT_REFRESH_MS (60s, see
// lib/useAutoRefresh.ts), so a cache window shorter than that never makes
// what a viewer sees any staler than the page's own refresh cadence already
// allows — it only collapses however many admin/manager viewers poll within
// that window into ONE real computation per department instead of one each.
// Keyed by department NAME (not by viewer or scope), so an org-wide viewer
// and a department manager who both cover e.g. "AI" share the same cache
// entry rather than each paying for their own copy of the same computation.
// That matters because the underlying computation is expensive
// (computeDepartmentScore does several full-table scans per department) and
// this app runs on a hard-capped connection budget: the DB role is capped at
// 20 connections, Sequelize's own pool is 10 per Node process, and
// lib/useAutoRefresh.ts's own comment already names this exact failure mode
// — "multiply [the per-request cost] by 45 active users on a few seconds'
// timer and the refresh is the outage." Every admin/manager polling
// independently was doing exactly that multiplication; this caps it at one
// computation per department per TTL window, no matter how many are watching.
const HEALTH_CACHE_TTL_MS = 30_000;
const healthCache = new Map<string, { result: { department: string } & ScoreResult; expiresAt: number }>();

// requestCache is the SAME ScoringDataCache the caller shares across every
// department in one request (see the comment on ScoringDataCache itself) —
// still worth keeping even with the TTL cache above it, so a burst of
// several departments all missing at once (e.g. right after this cache's
// first-ever fill, or right after a TTL expiry) still shares one query per
// underlying dataset instead of one per department.
async function cachedDepartmentScore(d: { id: string; name: string }, requestCache: ScoringDataCache): Promise<{ department: string } & ScoreResult> {
  const hit = healthCache.get(d.name);
  if (hit && hit.expiresAt > Date.now()) return hit.result;
  const result = { department: d.name, ...(await safeScore(d.name, await teamFor(d.id), requestCache)) };
  healthCache.set(d.name, { result, expiresAt: Date.now() + HEALTH_CACHE_TTL_MS });
  return result;
}

async function teamFor(departmentId: string): Promise<TeamMember[]> {
  const rows = await db.User.findAll({
    where: { departmentId, status: 'active' } as never,
    // `name` is needed by the Accounts scorer, whose payment-queue records
    // identify who paid by display name rather than username.
    attributes: ['id', 'username', 'name']
  });
  return rows.map((r) => ({ id: r.get('id') as string, username: r.get('username') as string, name: (r.get('name') as string) || '' }));
}

// One department's data problem must not blank the whole Department Health
// section: Promise.all rejects as a unit, so a single scorer throwing used to
// take every other gauge down with it and the dashboard rendered nothing at
// all (the section is hidden when gauges is empty). Each department is now
// scored independently and a failure degrades to that one gauge reading N/A.
// The error is logged rather than swallowed, so a real fault is still visible
// in the server output instead of silently becoming "no data".
async function safeScore(departmentName: string, team: TeamMember[], cache: ScoringDataCache) {
  try {
    return await computeDepartmentScore(departmentName, team, cache);
  } catch (error) {
    console.error(`[dashboard/health] scoring "${departmentName}" failed:`, error);
    return {
      score: 0,
      band: 'na' as const,
      breakdown: [],
      members: [],
      formula: 'This department’s health could not be calculated — see the server log.'
    };
  }
}

// Dashboard traffic-light gauges: an org-wide viewer gets one gauge per
// active department (that department's team average); a department manager
// gets one gauge for just the department(s) they manage; everyone else gets
// one personal gauge (the same per-department formula, run over a team of
// just themselves). See lib/departmentScoring.ts for the actual formulas.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const scope = await resolveVisibilityScope(viewer.username);

    if (scope.seesOrgWide) {
      const departments = await listActiveDepartments();
      // One cache shared across every department in this request — several
      // department names map to the same underlying dataset (e.g. Sales +
      // GEM - Sales, or AV + Robotics + AI), so without a shared cache each
      // of these concurrent Promise.all branches re-runs the same full-table
      // query. See lib/departmentScoring.ts's ScoringDataCache.
      const cache: ScoringDataCache = {};
      const gauges = await Promise.all(departments.map((d) => cachedDepartmentScore(d, cache)));
      return NextResponse.json({ scope: 'org', gauges });
    }

    const managed = await departmentsManagedBy(viewer.username);
    if (managed.length) {
      const cache: ScoringDataCache = {};
      const gauges = await Promise.all(managed.map((d) => cachedDepartmentScore(d, cache)));
      return NextResponse.json({ scope: 'department', gauges });
    }

    const deptInfo = await findUserNameAndDeptByUsername(viewer.username);
    const selfTeam: TeamMember[] = [{ id: viewer.userId, username: viewer.username, name: deptInfo?.name || '' }];
    const result = await safeScore(deptInfo?.department || '', selfTeam, {});
    return NextResponse.json({ scope: 'self', gauges: [{ department: deptInfo?.department || 'You', ...result }] });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
