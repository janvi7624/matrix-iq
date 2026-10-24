import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { canManagePartners } from '@/lib/partnerAccess';
import { PartnerSubmissionError, reviewPartnerSubmission } from '@/lib/partnerProjectStore';
import { PARTNER_SUBMISSION_STATUSES, PartnerSubmissionStatus } from '@/lib/partnerProjectStages';
import { findSalesPersonCandidate, SalesOwnerError } from '@/lib/projectSalesOwner';
import { findPartnerById } from '@/lib/partnerStore';
import { notifyUsers } from '@/lib/notificationStore';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { db } from '@/lib/db';

// Sales accepts, refuses, or asks for more on a partner submission.
//
// Authorization is canManagePartners — the same rule that governs who may
// create a partner in the first place, resolved from Department Master's
// Sales managers (see lib/partnerAccess.ts). Deliberately NOT the project's
// own edit permission: an unreviewed submission is attributed to the
// relationship manager, so the ordinary "can you edit this project" check
// would let the RM accept their own incoming work unreviewed.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canManagePartners(viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => null);
  const decision = typeof body?.decision === 'string' ? body.decision : '';
  const remarks = typeof body?.remarks === 'string' ? body.remarks : '';

  if (!PARTNER_SUBMISSION_STATUSES.includes(decision as PartnerSubmissionStatus) || decision === 'submitted') {
    return NextResponse.json({ error: 'Decision must be approved, rejected, or info_requested' }, { status: 400 });
  }

  try {
    const { id } = await params;

    // On approval the project needs a real sales owner. Validated through
    // the existing findSalesPersonCandidate so the same "is this an active
    // member of Sales" rule applies as everywhere else ownership is set —
    // a partner project must not be assignable to someone the normal
    // assignment flow would refuse.
    let salesPersonUsername: string | undefined;
    let salesPersonUserId: string | undefined;
    if (decision === 'approved' && typeof body?.salesPersonId === 'string' && body.salesPersonId) {
      const candidate = await findSalesPersonCandidate(body.salesPersonId);
      salesPersonUsername = candidate.username;
      salesPersonUserId = candidate.id;
    }

    const approxPrice = typeof body?.approxPrice === 'number' ? body.approxPrice : Number(body?.approxPrice);

    const project = await reviewPartnerSubmission(id, {
      decision: decision as PartnerSubmissionStatus,
      remarks,
      reviewerUserId: viewer.userId,
      reviewerUsername: viewer.username,
      salesPersonUsername,
      salesPersonUserId,
      approxPrice: Number.isFinite(approxPrice) && approxPrice > 0 ? approxPrice : undefined
    });
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

    const record = project as unknown as Record<string, unknown>;
    const partner = await findPartnerById((record.partner_id as string) || '');

    // Notify the partner's own portal users, plus the newly assigned
    // salesperson. Partner notifications are scoped by partnerId, so one
    // partner can never be told about another's submission.
    if (partner) {
      const partnerUsers = await db.User.findAll({ where: { partnerId: partner.id, status: 'active' } as never, attributes: ['username'] });
      const usernames = partnerUsers.map((u) => u.get('username') as string);
      const headline =
        decision === 'approved' ? 'Your submission was accepted' : decision === 'rejected' ? 'Your submission was not taken forward' : 'More information needed';
      if (usernames.length) {
        void notifyUsers(usernames, {
          title: headline,
          body: remarks || `${record.project_name || record.company || record.client_name}`,
          type: 'partner_submission_reviewed',
          entityType: 'partner_project',
          entityId: id
        });
      }
    }
    if (salesPersonUsername) {
      void notifyUsers([salesPersonUsername], {
        title: 'Partner project assigned to you',
        body: `${partner?.company_name ?? 'A partner'} submitted "${record.project_name || record.company}" — now yours to take forward.`,
        type: 'partner_project_assigned',
        entityType: 'project',
        entityId: id
      });
    }

    void logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'project',
      entityId: id,
      action: `Partner submission ${decision}${salesPersonUsername ? ` and assigned to ${salesPersonUsername}` : ''}`,
      previousStatus: 'submitted',
      newStatus: decision,
      remarks,
      ip: getClientIp(request)
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof PartnerSubmissionError) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof SalesOwnerError) return NextResponse.json({ error: error.message }, { status: error.status });
    return apiErrorResponse(error);
  }
}
