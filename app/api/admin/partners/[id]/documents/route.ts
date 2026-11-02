import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { canReviewPartnerDocuments } from '@/lib/partnerAccess';
import { findPartnerById } from '@/lib/partnerStore';
import { listPartnerDocuments, reviewPartnerDocument, PartnerDocumentError } from '@/lib/partnerDocumentStore';
import { onboardingProgress, PARTNER_DOCUMENT_LABEL, isPartnerDocumentKind } from '@/lib/partnerOnboarding';
import { notifyUsers } from '@/lib/notificationStore';
import { listPartnerUsers } from '@/lib/partnerUserStore';
import { apiErrorResponse } from '@/lib/apiError';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';

// The internal side of partner onboarding: read the three documents, and
// approve or reject one.
//
// Gated on canReviewPartnerDocuments — the person who CREATED the account or
// its relationship manager, with the usual admin/sales-manager override.
// Deliberately narrower than canManagePartners for the review itself: the
// requirement is that the account creator signs these off, not anyone who
// happens to have partner permissions.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const partner = await findPartnerById(id);
  if (!partner) return NextResponse.json({ error: 'Partner not found' }, { status: 404 });
  if (!(await canReviewPartnerDocuments(viewer, partner))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const documents = await listPartnerDocuments(id);
    return NextResponse.json({ documents, progress: onboardingProgress(documents), onboarded_at: partner.onboarded_at });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const partner = await findPartnerById(id);
  if (!partner) return NextResponse.json({ error: 'Partner not found' }, { status: 404 });
  if (!(await canReviewPartnerDocuments(viewer, partner))) {
    return NextResponse.json(
      { error: 'Forbidden — only this partner’s account creator or relationship manager can approve their documents.' },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const kind = typeof (body as { kind?: unknown })?.kind === 'string' ? (body as { kind: string }).kind : '';
  const decision = (body as { decision?: unknown })?.decision === 'rejected' ? 'rejected' : 'approved';
  const remarks = typeof (body as { remarks?: unknown })?.remarks === 'string' ? (body as { remarks: string }).remarks : '';

  if (!isPartnerDocumentKind(kind)) return NextResponse.json({ error: 'Unknown document type.' }, { status: 400 });

  try {
    const { document, onboardingCompleted } = await reviewPartnerDocument(id, kind, decision, viewer.userId, remarks);

    // The partner is always told — this is the only signal they get that
    // they may proceed, or that something needs replacing and why.
    const partnerUsers = await listPartnerUsers(id);
    const usernames = partnerUsers.filter((u) => u.status === 'active').map((u) => u.username);
    if (usernames.length) {
      await notifyUsers(usernames, {
        title: onboardingCompleted
          ? 'Your account is now fully active'
          : `${PARTNER_DOCUMENT_LABEL[kind]} ${decision === 'approved' ? 'approved' : 'needs replacing'}`,
        body: onboardingCompleted
          ? 'All onboarding documents have been approved. The full partner portal is now open to you.'
          : decision === 'approved'
            ? `Your ${PARTNER_DOCUMENT_LABEL[kind]} has been approved.`
            : `Your ${PARTNER_DOCUMENT_LABEL[kind]} was not accepted: ${document.review_remarks}`,
        type: 'partner_document_reviewed',
        entityType: 'partner',
        entityId: id
      });
    }

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'partner',
      entityId: id,
      action: `${PARTNER_DOCUMENT_LABEL[kind]} ${decision} for ${partner.company_name}`,
      previousStatus: 'pending',
      newStatus: decision,
      remarks: onboardingCompleted ? `${document.review_remarks} (onboarding completed)` : document.review_remarks,
      ip: getClientIp(request)
    });

    const documents = await listPartnerDocuments(id);
    return NextResponse.json({ document, documents, progress: onboardingProgress(documents), onboardingCompleted });
  } catch (error) {
    if (error instanceof PartnerDocumentError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return apiErrorResponse(error);
  }
}
