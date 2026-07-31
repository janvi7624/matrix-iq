import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { demoScheduleStore } from '@/lib/demoScheduleStore';
import { appendProjectTimeline } from '@/lib/projectStore';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { DemoScheduleRecord, DemoTechnicalApproval } from '@/lib/types';

// The assigned_technical_person on the request is a free-text name from the
// fixed roster (no real login yet — same limitation as domain leads, see
// lib/domainLeads.ts), so the actual approval action is available to any
// account with the "technical" role, or admin/manager/superadmin as a stand-in.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (viewer.role !== 'technical' && !viewer.isPrivileged) {
    return NextResponse.json({ error: 'Forbidden — technical team only' }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || (body.decision !== 'approved' && body.decision !== 'rejected' && body.decision !== 'reschedule')) {
    return NextResponse.json({ error: 'A valid decision is required' }, { status: 400 });
  }

  try {
    const records = await demoScheduleStore.list(viewer.username, true);
    const existing = records.find((r) => r.id === id);
    if (!existing) return NextResponse.json({ error: 'Demo not found' }, { status: 404 });
    if (existing.status !== 'pending_technical') {
      return NextResponse.json({ error: 'This request is not awaiting technical approval' }, { status: 400 });
    }

    const technicalApproval: DemoTechnicalApproval = {
      decision: body.decision,
      availability: body.availability === 'available' || body.availability === 'not_available' ? body.availability : '',
      remarks: typeof body.remarks === 'string' ? body.remarks.trim() : '',
      expected_arrival_time: typeof body.expectedArrivalTime === 'string' ? body.expectedArrivalTime : '',
      decided_by: viewer.username,
      decided_at: new Date().toISOString()
    };

    const patch: Partial<DemoScheduleRecord> = { technical_approval: technicalApproval };
    if (body.decision === 'approved') patch.status = 'pending_manager';
    else if (body.decision === 'rejected') patch.status = 'cancelled';
    else if (body.decision === 'reschedule' && typeof body.newScheduledAt === 'string' && body.newScheduledAt) {
      patch.scheduled_at = body.newScheduledAt;
    }

    const updated = await demoScheduleStore.update(id, patch);

    if (existing.project_id) {
      await appendProjectTimeline(existing.project_id, {
        by: viewer.username,
        stage: 'demo',
        label: `Technical availability: ${body.decision}`,
        remarks: technicalApproval.remarks
      });
    }
    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'demo',
      entityId: id,
      action: `Technical approval: ${body.decision}`,
      previousStatus: 'pending_technical',
      newStatus: patch.status || 'pending_technical',
      remarks: technicalApproval.remarks,
      ip: getClientIp(request)
    });

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
