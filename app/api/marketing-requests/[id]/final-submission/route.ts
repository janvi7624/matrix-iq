import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { marketingRequestStore } from '@/lib/marketingRequestStore';
import { isModuleActionAllowed } from '@/lib/permissions';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { notifyUsers } from '@/lib/notificationStore';
import { MarketingRequestRecord } from '@/lib/types';

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  try {
    const records = await marketingRequestStore.list(viewer.username, true);
    const existing = records.find((r) => r.id === id);
    if (!existing) return NextResponse.json({ error: 'Marketing request not found' }, { status: 404 });

    const isAssigned = existing.assigned_to === viewer.username;
    const isPrivilegedOrReviewer = viewer.isPrivileged || (await isModuleActionAllowed(viewer, 'marketing-requests', 'approve'));

    // If assigned to a specific marketing member: ONLY that member (or superadmin) can complete final submission
    if (existing.assigned_to) {
      if (!isAssigned && viewer.role !== 'superadmin') {
        return NextResponse.json(
          {
            error: `Forbidden — this request is assigned to ${existing.assigned_to_name || existing.assigned_to}. Only the assigned marketing member can submit the final result to the requester.`
          },
          { status: 403 }
        );
      }
    } else {
      if (!isPrivilegedOrReviewer) {
        return NextResponse.json({ error: 'Forbidden — only Marketing team members can submit the final result' }, { status: 403 });
      }
    }

    // Must accept the assignment before doing any work on it — see
    // assign/route.ts and accept-assignment/decline-assignment.
    if (isAssigned && !isPrivilegedOrReviewer && existing.assignment_status === 'pending') {
      return NextResponse.json({ error: 'You must accept this assignment before you can act on it' }, { status: 403 });
    }

    const finalNotes = typeof body.finalSubmissionNotes === 'string' ? body.finalSubmissionNotes.trim() : '';
    const finalFiles = Array.isArray(body.finalSubmissionFiles) ? toStringArray(body.finalSubmissionFiles) : [];
    const marketingPreparedContent =
      typeof body.marketingPreparedContent === 'string'
        ? body.marketingPreparedContent.trim()
        : existing.marketing_prepared_content;

    const patch: Partial<MarketingRequestRecord> = {
      status: 'completed',
      marketing_prepared_content: marketingPreparedContent,
      final_submission_notes: finalNotes,
      final_submission_files: finalFiles,
      completion_notes: finalNotes || existing.completion_notes,
      delivered_files: finalFiles.length > 0 ? finalFiles : existing.delivered_files,
      updated_at: new Date().toISOString()
    };

    const updated = await marketingRequestStore.update(id, patch);

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'marketing_request',
      entityId: id,
      action: `Final result delivered to original requester (${existing.created_by})`,
      previousStatus: existing.status,
      newStatus: 'completed',
      remarks: finalNotes || 'Marketing deliverables finalized and completed',
      ip: getClientIp(request)
    });

    if (existing.created_by && existing.created_by !== viewer.username) {
      await notifyUsers([existing.created_by], {
        title: 'Marketing request completed!',
        body: `Your request "${existing.title}" is ready and completed by ${viewer.username}.`,
        type: 'marketing_request_completed',
        entityType: 'marketing_request',
        entityId: id
      });
    }

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
