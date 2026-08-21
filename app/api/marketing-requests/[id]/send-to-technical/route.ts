import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { marketingRequestStore } from '@/lib/marketingRequestStore';
import { isModuleActionAllowed } from '@/lib/permissions';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { notifyUsers } from '@/lib/notificationStore';
import { findUserById } from '@/lib/userStore';
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

    // If assigned to a specific marketing member: ONLY that member (or superadmin/manager) can prepare and send to Technical
    if (existing.assigned_to) {
      if (!isAssigned && !isPrivilegedOrReviewer && viewer.role !== 'superadmin') {
        return NextResponse.json(
          {
            error: `Forbidden — this request is assigned to ${existing.assigned_to_name || existing.assigned_to}. Only the assigned marketing member can prepare content and send to Technical.`
          },
          { status: 403 }
        );
      }
    } else {
      if (!isPrivilegedOrReviewer) {
        return NextResponse.json({ error: 'Forbidden — only Marketing team members can send requests to Technical' }, { status: 403 });
      }
    }

    const technicalMemberId =
      typeof body.technicalMemberId === 'string' && body.technicalMemberId.trim()
        ? body.technicalMemberId.trim()
        : existing.technical_member_id;

    if (!technicalMemberId) {
      return NextResponse.json(
        { error: 'Technical team member has not been selected yet by the Marketing Manager. Please ask Manager to assign a Technical verifier.' },
        { status: 400 }
      );
    }

    const technicalUser = await findUserById(technicalMemberId);
    if (!technicalUser) {
      return NextResponse.json({ error: 'Selected Technical Team member not found' }, { status: 400 });
    }

    const marketingPreparedContent = typeof body.marketingPreparedContent === 'string' ? body.marketingPreparedContent.trim() : existing.marketing_prepared_content || '';
    const marketingRemarks = typeof body.marketingRemarks === 'string' ? body.marketingRemarks.trim() : existing.marketing_remarks || '';
    const technicalInstructions = typeof body.technicalInstructions === 'string' ? body.technicalInstructions.trim() : existing.technical_instructions || '';
    const marketingAttachments = Array.isArray(body.marketingAttachments) ? toStringArray(body.marketingAttachments) : existing.marketing_attachments || [];

    const patch: Partial<MarketingRequestRecord> = {
      status: 'pending_technical_review',
      technical_member_id: technicalUser.id,
      technical_member_username: technicalUser.username,
      technical_member_name: technicalUser.name || technicalUser.username,
      marketing_prepared_content: marketingPreparedContent,
      marketing_attachments: marketingAttachments,
      marketing_remarks: marketingRemarks,
      technical_instructions: technicalInstructions,
      // If unassigned in marketing, assign to the current marketing member
      assigned_to: existing.assigned_to || viewer.username,
      updated_at: new Date().toISOString()
    };

    const updated = await marketingRequestStore.update(id, patch);

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'marketing_request',
      entityId: id,
      action: `Marketing request sent to Technical (${technicalUser.name || technicalUser.username}) for verification`,
      previousStatus: existing.status,
      newStatus: 'pending_technical_review',
      remarks: marketingRemarks || technicalInstructions || `Assigned to ${technicalUser.username}`,
      ip: getClientIp(request)
    });

    if (technicalUser.username && technicalUser.username !== viewer.username) {
      await notifyUsers([technicalUser.username], {
        title: 'Marketing request awaiting technical verification',
        body: `${viewer.username} submitted "${existing.title}" for your technical review and verification.`,
        type: 'marketing_technical_review_assigned',
        entityType: 'marketing_request',
        entityId: id
      });
    }

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
