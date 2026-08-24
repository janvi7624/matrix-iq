import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { travelScheduleStore } from '@/lib/travelScheduleStore';
import { logAudit } from '@/lib/auditLogStore';
import { notifyUsers } from '@/lib/notificationStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { listDepartmentManagers } from '@/lib/departmentStore';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const decision = body.decision as string;
  if (decision !== 'approve' && decision !== 'request_changes') {
    return NextResponse.json({ error: 'Invalid decision' }, { status: 400 });
  }

  try {
    const existing = await travelScheduleStore.findById(id);
    if (!existing) return NextResponse.json({ error: 'Travel request not found' }, { status: 404 });
    if (existing.status !== 'ticket_booking') {
      return NextResponse.json({ error: 'This request is not awaiting HR final verification' }, { status: 400 });
    }

    // Authorization: HR department managers or admin/superadmin override
    const isOverride = viewer.role === 'admin' || viewer.role === 'superadmin';
    const hrManagers = (await listDepartmentManagers())['HR'] || [];
    const isHrManager = hrManagers.some((m) => m.username === viewer.username);
    if (!isHrManager && !isOverride) {
      if (!viewer.isPrivileged) return NextResponse.json({ error: 'Only HR can perform final verification' }, { status: 403 });
    }

    const remarks = typeof body.remarks === 'string' ? body.remarks.trim() : '';
    const newStatus = decision === 'approve' ? 'completed' : 'changes_requested';

    const updated = await travelScheduleStore.hrFinalVerify(id, newStatus as 'completed' | 'changes_requested', viewer.username, remarks);

    await logAudit({
      by: viewer.username, role: viewer.role, entityType: 'travel_schedule', entityId: id,
      action: decision === 'approve' ? 'hr_final_approve' : 'hr_final_request_changes',
      previousStatus: existing.status, newStatus, remarks, ip: getClientIp(request)
    });

    if (decision === 'approve') {
      // Notify employee — travel confirmed
      await notifyUsers([existing.created_by], {
        title: 'Travel confirmed',
        body: `Your travel request ${existing.request_code} (${existing.origin} → ${existing.destination}) is confirmed. Check your travel details.`,
        type: 'travel_completed', entityType: 'travel_schedule', entityId: id
      });
    } else {
      // Send back for corrections — notify the relevant team
      await notifyUsers([existing.created_by], {
        title: 'Travel request needs corrections',
        body: `Your travel request ${existing.request_code} needs corrections (HR Final): ${remarks}`,
        type: 'travel_changes_requested', entityType: 'travel_schedule', entityId: id
      });
    }

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
