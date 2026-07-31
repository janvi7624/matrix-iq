import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { demoScheduleStore } from '@/lib/demoScheduleStore';
import { appendProjectTimeline } from '@/lib/projectStore';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { DemoManagerApproval, DemoScheduleRecord } from '@/lib/types';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!viewer.isPrivileged) return NextResponse.json({ error: 'Forbidden — manager only' }, { status: 403 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || (body.decision !== 'approved' && body.decision !== 'rejected' && body.decision !== 'modified')) {
    return NextResponse.json({ error: 'A valid decision is required' }, { status: 400 });
  }

  try {
    const records = await demoScheduleStore.list(viewer.username, true);
    const existing = records.find((r) => r.id === id);
    if (!existing) return NextResponse.json({ error: 'Demo not found' }, { status: 404 });
    if (existing.status !== 'pending_manager') {
      return NextResponse.json({ error: 'This request is not awaiting manager approval' }, { status: 400 });
    }

    const managerApproval: DemoManagerApproval = {
      decision: body.decision,
      remarks: typeof body.remarks === 'string' ? body.remarks.trim() : '',
      reassigned_engineer: typeof body.reassignedEngineer === 'string' ? body.reassignedEngineer.trim() : '',
      decided_by: viewer.username,
      decided_at: new Date().toISOString()
    };

    const patch: Partial<DemoScheduleRecord> = { manager_approval: managerApproval };
    if (managerApproval.reassigned_engineer) patch.assigned_technical_person = managerApproval.reassigned_engineer;
    if (typeof body.newScheduledAt === 'string' && body.newScheduledAt) patch.scheduled_at = body.newScheduledAt;

    if (body.decision === 'approved') patch.status = 'pending_backoffice';
    else if (body.decision === 'rejected') patch.status = 'cancelled';
    // 'modified' stays at pending_manager — schedule/engineer changes above apply, a follow-up call approves.

    const updated = await demoScheduleStore.update(id, patch);

    if (existing.project_id) {
      await appendProjectTimeline(existing.project_id, {
        by: viewer.username,
        stage: 'demo',
        label: `Manager review: ${body.decision}`,
        remarks: managerApproval.remarks
      });
    }
    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'demo',
      entityId: id,
      action: `Manager approval: ${body.decision}`,
      previousStatus: 'pending_manager',
      newStatus: patch.status || 'pending_manager',
      remarks: managerApproval.remarks,
      ip: getClientIp(request)
    });

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
