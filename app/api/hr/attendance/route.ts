import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { requireHrModule, isHrManager } from '@/lib/hrAccess';
import { listForDate, markAttendance } from '@/lib/attendanceStore';
import { findUserByUsername } from '@/lib/userStore';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { AttendanceStatus } from '@/lib/types';

const VALID_STATUS: AttendanceStatus[] = ['present', 'absent', 'half_day', 'on_leave', 'holiday', 'wfh'];

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireHrModule(viewer, 'hr-attendance'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const date = request.nextUrl.searchParams.get('date');
  if (!date) return NextResponse.json({ error: 'A date is required' }, { status: 400 });

  try {
    return NextResponse.json(await listForDate(date));
  } catch (error) {
    return apiErrorResponse(error);
  }
}

// Marks (or re-marks) one employee's attendance for one date. isHrManager
// only — a plain 'hr'-role employee can view the register but not edit it.
export async function POST(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireHrModule(viewer, 'hr-attendance')) || !(await isHrManager(viewer))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const userId = typeof body?.userId === 'string' ? body.userId.trim() : '';
  const date = typeof body?.date === 'string' ? body.date : '';
  if (!userId || !date || !VALID_STATUS.includes(body?.status)) {
    return NextResponse.json({ error: 'userId, date, and a valid status are required' }, { status: 400 });
  }

  try {
    const actor = await findUserByUsername(viewer.username);
    if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const record = await markAttendance({ userId, date, status: body.status, markedByUserId: actor.id, remarks: typeof body.remarks === 'string' ? body.remarks.trim() : '' });

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'attendance',
      entityId: record.id,
      action: `Attendance marked: ${record.user_name} — ${body.status} (${date})`,
      previousStatus: '',
      newStatus: body.status,
      ip: getClientIp(request)
    });

    return NextResponse.json(record);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
