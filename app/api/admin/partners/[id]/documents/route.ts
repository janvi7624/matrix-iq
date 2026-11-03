import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { canReviewPartnerDocuments } from '@/lib/partnerAccess';
import { findPartnerById } from '@/lib/partnerStore';
import { listPartnerDocuments, reviewPartnerDocument, submitPartnerDocument, PartnerDocumentError } from '@/lib/partnerDocumentStore';
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

// Upload a document on the partner's behalf.
//
// The option exists because a signed agreement often reaches us by email
// before the partner ever logs in — making them re-upload it through the
// portal just to satisfy the flow is busywork.
//
// Gated on the same canReviewPartnerDocuments as approving, and that is what
// makes the auto-approval safe: only somebody who could have approved this
// document may supply it. See SubmitDocumentInput.approvedByUploader.
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const partner = await findPartnerById(id);
  if (!partner) return NextResponse.json({ error: 'Partner not found' }, { status: 404 });
  if (!(await canReviewPartnerDocuments(viewer, partner))) {
    return NextResponse.json(
      { error: 'Forbidden — only this partner’s account creator or relationship manager can supply their documents.' },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const kind = typeof (body as { kind?: unknown })?.kind === 'string' ? (body as { kind: string }).kind : '';
  const rawFiles = Array.isArray((body as { files?: unknown })?.files) ? (body as { files: unknown[] }).files : [];
  if (!isPartnerDocumentKind(kind)) return NextResponse.json({ error: 'Unknown document type.' }, { status: 400 });

  const files = rawFiles
    .filter((f): f is { name?: string; path: string } => !!f && typeof (f as { path?: unknown }).path === 'string')
    .map((f) => ({ name: typeof f.name === 'string' ? f.name : 'document', path: f.path }));
  // Staff uploads land in the internal prefix, not the partner's own — they
  // came through an employee session. Only traversal is refused here.
  if (files.some((f) => f.path.includes('..'))) {
    return NextResponse.json({ error: 'That file path is not acceptable.' }, { status: 400 });
  }

  try {
    const document = await submitPartnerDocument({
      partnerId: id,
      kind,
      files,
      submittedById: viewer.userId,
      approvedByUploader: true
    });

    const fresh = await findPartnerById(id);
    const onboardingCompleted = !partner.onboarded_at && !!fresh?.onboarded_at;

    if (onboardingCompleted) {
      const partnerUsers = await listPartnerUsers(id);
      const usernames = partnerUsers.filter((u) => u.status === 'active').map((u) => u.username);
      if (usernames.length) {
        await notifyUsers(usernames, {
          title: 'Your account is now fully active',
          body: 'All onboarding documents are on file. The full partner portal is now open to you.',
          type: 'partner_document_reviewed',
          entityType: 'partner',
          entityId: id
        });
      }
    }

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'partner',
      entityId: id,
      action: `${PARTNER_DOCUMENT_LABEL[kind]} provided by our team for ${partner.company_name}`,
      previousStatus: '',
      newStatus: 'approved',
      remarks: onboardingCompleted ? 'Onboarding completed' : `${files.length} file${files.length === 1 ? '' : 's'}`,
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
