import { NextRequest, NextResponse } from 'next/server';
import { getPartnerViewer } from '@/lib/partnerContext';
import { listPartnerDocuments, submitPartnerDocument, PartnerDocumentError } from '@/lib/partnerDocumentStore';
import { onboardingProgress, partnerOnboardingComplete, PARTNER_DOCUMENT_LABEL, isPartnerDocumentKind } from '@/lib/partnerOnboarding';
import { partnerUploadPrefix } from '@/lib/partnerUploads';
import { notifyUsers } from '@/lib/notificationStore';
import { apiErrorResponse } from '@/lib/apiError';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';

// The partner's own onboarding: see what they owe, and upload it.
//
// allowDuringOnboarding is the point of this route — every other
// /api/partner/** route is closed to a partner whose documents are not yet
// approved, and these two are the exception that lets them comply.
export async function GET(request: NextRequest) {
  const viewer = await getPartnerViewer(request, { allowDuringOnboarding: true });
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const documents = await listPartnerDocuments(viewer.partnerId);
    return NextResponse.json({
      documents,
      progress: onboardingProgress(documents),
      complete: partnerOnboardingComplete(viewer.partner),
      // Named so the partner knows who is reviewing, rather than waiting on
      // "someone at the company".
      accountManagerName: viewer.partner.created_by_name || viewer.partner.relationship_manager_name || '',
      uploadPrefix: partnerUploadPrefix(viewer.partnerId)
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

// Upload or replace one document. Sends it (back) to the account creator for
// review — see submitPartnerDocument on why a replacement resets the status
// and clears the previous remark.
export async function POST(request: NextRequest) {
  const viewer = await getPartnerViewer(request, { allowDuringOnboarding: true });
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const kind = typeof (body as { kind?: unknown })?.kind === 'string' ? (body as { kind: string }).kind : '';
  const rawFiles = Array.isArray((body as { files?: unknown })?.files) ? (body as { files: unknown[] }).files : [];

  if (!isPartnerDocumentKind(kind)) {
    return NextResponse.json({ error: 'Unknown document type.' }, { status: 400 });
  }

  // Every path must sit under THIS partner's own upload prefix. The upload
  // route already scopes writes, but a hand-rolled request could otherwise
  // name another partner's file here and have it rendered back to them as
  // their own agreement.
  const prefix = partnerUploadPrefix(viewer.partnerId);
  const files = rawFiles
    .filter((f): f is { name?: string; path: string; size?: number } => !!f && typeof (f as { path?: unknown }).path === 'string')
    .map((f) => ({ name: typeof f.name === 'string' ? f.name : 'document', path: f.path, size: typeof f.size === 'number' ? f.size : undefined }));
  if (files.some((f) => !f.path.startsWith(prefix) || f.path.includes('..'))) {
    return NextResponse.json({ error: 'That file does not belong to this partner account.' }, { status: 400 });
  }

  try {
    const document = await submitPartnerDocument({
      partnerId: viewer.partnerId,
      kind,
      files,
      submittedById: viewer.userId
    });

    // Tell whoever has to act on it. Without this the document sits waiting
    // on somebody who has no reason to look.
    const reviewers = [viewer.partner.created_by_name ? viewer.partner.created_by : '', viewer.partner.relationship_manager_id]
      .filter((id): id is string => !!id);
    if (reviewers.length) {
      const { db } = await import('@/lib/db');
      const rows = await db.User.findAll({ where: { id: [...new Set(reviewers)] } as never, attributes: ['username'] });
      const usernames = rows.map((r) => r.get('username') as string).filter(Boolean);
      if (usernames.length) {
        await notifyUsers(usernames, {
          title: `${viewer.partner.company_name} uploaded their ${PARTNER_DOCUMENT_LABEL[kind]}`,
          body: 'Review it in Partner Management — the partner stays limited to the onboarding screen until all three documents are approved.',
          type: 'partner_document_submitted',
          entityType: 'partner',
          entityId: viewer.partnerId
        });
      }
    }

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'partner',
      entityId: viewer.partnerId,
      action: `Partner uploaded ${PARTNER_DOCUMENT_LABEL[kind]}`,
      previousStatus: '',
      newStatus: 'pending',
      remarks: `${files.length} file${files.length === 1 ? '' : 's'}`,
      ip: getClientIp(request)
    });

    const documents = await listPartnerDocuments(viewer.partnerId);
    return NextResponse.json({ document, documents, progress: onboardingProgress(documents) }, { status: 201 });
  } catch (error) {
    if (error instanceof PartnerDocumentError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return apiErrorResponse(error);
  }
}
