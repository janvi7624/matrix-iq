import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { applyLeave, InvalidLeaveRequestError, list } from '@/lib/leaveRequestStore';
import { resolveVisibilityScope } from '@/lib/departmentScope';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { LeaveType } from '@/lib/types';

const VALID_TYPE: LeaveType[] = ['casual', 'sick', 'earned', 'unpaid', 'other'];

// The viewer's own leave history, plus — if they manage a department —
// their team's pending requests to decide on.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const mine = await list({ userIds: [viewer.userId] });
    const scope = await resolveVisibilityScope(viewer.username);
    const teamIds = (scope.scopedUserIds ?? []).filter((id) => id !== viewer.userId);
    const teamPending = teamIds.length || scope.seesOrgWide ? await list({ userIds: scope.seesOrgWide ? undefined : teamIds, status: 'pending' }) : [];
    return NextResponse.json({ mine, teamPending: scope.seesOrgWide ? teamPending.filter((r) => r.user_id !== viewer.userId) : teamPending });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

// Any authenticated user may apply for their own leave.
export async function POST(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || !VALID_TYPE.includes(body.leaveType) || typeof body.startDate !== 'string' || typeof body.endDate !== 'string') {
    return NextResponse.json({ error: 'leaveType, startDate, and endDate are required' }, { status: 400 });
  }

  try {
    const created = await applyLeave({
      userId: viewer.userId,
      leaveType: body.leaveType,
      startDate: body.startDate,
      endDate: body.endDate,
      reason: typeof body.reason === 'string' ? body.reason.trim() : ''
    });

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'leave_request',
      entityId: created.id,
      action: `Leave requested: ${body.leaveType} (${body.startDate} to ${body.endDate})`,
      previousStatus: '',
      newStatus: 'pending',
      ip: getClientIp(request)
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof InvalidLeaveRequestError) return NextResponse.json({ error: error.message }, { status: 400 });
    return apiErrorResponse(error);
  }
}
