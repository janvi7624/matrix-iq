import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { resolveVisibilityScope } from '@/lib/departmentScope';
import { findUserById } from '@/lib/userStore';
import { listActiveEmployeesExcept, reassignEmployeeWork, ReassignmentValidationError, ReassignmentItem } from '@/lib/employeeExitStore';
import { apiErrorResponse } from '@/lib/apiError';

function parseItems(value: unknown): ReassignmentItem[] | null {
  if (!Array.isArray(value)) return null;
  const items: ReassignmentItem[] = [];
  for (const entry of value) {
    if (!entry || typeof entry.id !== 'string' || typeof entry.newOwnerId !== 'string') return null;
    items.push({ id: entry.id, newOwnerId: entry.newOwnerId });
  }
  return items;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { userId } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body.reassignments !== 'object') return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  try {
    const scope = await resolveVisibilityScope(viewer.username);
    if (!scope.seesOrgWide && !(scope.scopedUserIds ?? []).includes(userId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const exitingEmployee = await findUserById(userId);
    if (!exitingEmployee) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });

    const projects = parseItems(body.reassignments.projects);
    const tasks = parseItems(body.reassignments.tasks);
    const leads = parseItems(body.reassignments.leads);
    const quotations = parseItems(body.reassignments.quotations);
    if (!projects || !tasks || !leads || !quotations) {
      return NextResponse.json({ error: 'Each reassignment group must be an array of {id, newOwnerId}' }, { status: 400 });
    }

    // Every new owner must be an active employee within the viewer's own
    // scope, and never the exiting employee themselves.
    const eligible = await listActiveEmployeesExcept(userId, scope.seesOrgWide ? null : scope.scopedUserIds);
    const eligibleIds = new Set(eligible.map((e) => e.id));
    const allNewOwnerIds = [...projects, ...tasks, ...leads, ...quotations].map((i) => i.newOwnerId);
    if (allNewOwnerIds.some((id) => !eligibleIds.has(id))) {
      return NextResponse.json({ error: 'One or more selected replacements are not active/eligible employees' }, { status: 400 });
    }

    const setInactive = body.setInactive !== false;
    const result = await reassignEmployeeWork({
      exitingUserId: userId,
      exitingUsername: exitingEmployee.username,
      actorUsername: viewer.username,
      actorRole: viewer.role,
      projects,
      tasks,
      leads,
      quotations,
      setInactive
    });

    return NextResponse.json({ ok: true, reassignedCounts: result.reassignedCounts, employeeStatus: result.employeeStatus });
  } catch (error) {
    if (error instanceof ReassignmentValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    return apiErrorResponse(error);
  }
}
