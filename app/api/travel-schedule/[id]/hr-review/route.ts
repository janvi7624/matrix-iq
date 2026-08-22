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
    if (existing.status !== 'manager_approved') {
      return NextResponse.json({ error: 'This request is not awaiting HR review' }, { status: 400 });
    }

    // Authorization: HR department managers or admin/superadmin override
    const isOverride = viewer.role === 'admin' || viewer.role === 'superadmin';
    const hrManagers = (await listDepartmentManagers())['HR'] || [];
    const isHrManager = hrManagers.some((m) => m.username === viewer.username);
    if (!isHrManager && !isOverride) {
      if (!viewer.isPrivileged) return NextResponse.json({ error: 'Only HR can review this request' }, { status: 403 });
    }

    const remarks = typeof body.remarks === 'string' ? body.remarks.trim() : '';
    const hrDocuments = Array.isArray(body.hrDocuments) ? body.hrDocuments : [];
    const estimatedCost = typeof body.estimatedCost === 'number' ? body.estimatedCost : undefined;
    const newStatus = decision === 'approve' ? 'hr_reviewed' : 'changes_requested';

    const updated = await travelScheduleStore.hrReview(id, newStatus as 'hr_reviewed' | 'changes_requested', viewer.username, {
      remarks, hr_documents: hrDocuments, estimated_cost: estimatedCost
    });

    await logAudit({
      by: viewer.username, role: viewer.role, entityType: 'travel_schedule', entityId: id,
      action: decision === 'approve' ? 'hr_approve' : 'hr_request_changes',
      previousStatus: existing.status, newStatus, remarks, ip: getClientIp(request)
    });

    if (decision === 'approve') {
      // Notify Admin department
      const adminManagers = (await listDepartmentManagers())['Admin'] || (await listDepartmentManagers())['Administration'] || [];
      if (adminManagers.length) {
        await notifyUsers(adminManagers.map((m) => m.username), {
          title: 'Travel request needs admin approval',
          body: `${existing.created_by}'s travel request (${existing.origin} → ${existing.destination}) cleared by HR`,
          type: 'travel_admin_review', entityType: 'travel_schedule', entityId: id
        });
      }
    } else {
      await notifyUsers([existing.created_by], {
        title: 'Travel request needs changes',
        body: `Your travel request ${existing.request_code} needs changes (HR): ${remarks}`,
        type: 'travel_changes_requested', entityType: 'travel_schedule', entityId: id
      });
    }

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
