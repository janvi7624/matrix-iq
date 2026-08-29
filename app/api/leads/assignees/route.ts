import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { listUsers } from '@/lib/userStore';
import { canAssignLeads, canViewRole } from '@/lib/permissions';
import { departmentsManagedBy } from '@/lib/departmentStore';
import { apiErrorResponse } from '@/lib/apiError';

// Sales-side departments leads are routed within — same pair
// canAssignLeads() treats as the lead-management departments.
const SALES_DEPARTMENTS = ['Sales', 'GEM - Sales'];

// The reps a lead may be assigned to, for the assignment dropdown. Separate
// from /api/users/lite (every active user in the org) because routing a sales
// lead to, say, an Accounts clerk is a mistake the UI shouldn't offer.
//
// Only callable by someone who can actually assign — otherwise this is just a
// staff directory endpoint open to every login.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!(await canAssignLeads(viewer))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const [users, managed] = await Promise.all([listUsers(), departmentsManagedBy(viewer.username)]);
    const managedNames = new Set(managed.map((d) => d.name));

    const candidates = users.filter((u) => u.status === 'active' && canViewRole(viewer.role, u.role));

    // A sales rep is anyone in a sales department, plus anyone in a department
    // this viewer personally manages (so an org that renamed its sales team,
    // or runs several, still works).
    let assignable = candidates.filter((u) => SALES_DEPARTMENTS.includes(u.department) || managedNames.has(u.department));

    // Fallback rather than a dead dropdown: if none of the expected
    // departments exist in this deployment, offer everyone the viewer may see.
    // Better to let a manager pick than to make the feature unusable because
    // the department names don't match the seed.
    const usedFallback = assignable.length === 0;
    if (usedFallback) assignable = candidates;

    return NextResponse.json({
      usedFallback,
      assignees: assignable
        .map((u) => ({
          id: u.id,
          username: u.username,
          name: u.name || u.username,
          department: u.department,
          designation: u.designation
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
