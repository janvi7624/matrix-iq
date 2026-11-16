import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { canReviewPartnerDocuments } from '@/lib/partnerAccess';
import { findPartnerById } from '@/lib/partnerStore';
import { listPartnerDocuments, submitPartnerDocument, PartnerDocumentError } from '@/lib/partnerDocumentStore';
import { onboardingProgress, PARTNER_DOCUMENT_LABEL, isPartnerDocumentKind } from '@/lib/partnerOnboarding';
import {
  PartnerApprovalError,
  allStageApprovers,
  approverStagesFor,
  decideApprovalStage,
  stageApprovers,
  startApprovalIfReady
} from '@/lib/partnerApprovalStore';
import { PARTNER_APPROVAL_LABEL, isPartnerApprovalStage, PartnerApprovalStage } from '@/lib/partnerApprovalChain';
import { notifyUsers } from '@/lib/notificationStore';
import { listPartnerUsers } from '@/lib/partnerUserStore';
import { findUserById } from '@/lib/userStore';
import { apiErrorResponse } from '@/lib/apiError';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';

// The internal side of partner onboarding.
//   GET  — the documents (with files to view), where the approval chain is,
//          who signs off each step, and which step (if any) this viewer may decide.
//   POST — the current step's approver approves or rejects the set.
//   PUT  — staff upload a document on the partner's behalf (lands pending).
//
// Readable by the account's creator/RM/partner managers AND by every
// approver in the chain (Sales, Accounts and Administration managers) — they
// have to see the documents to sign them off.

async function canView(viewer: { userId: string; username: string; role: string; isPrivileged: boolean }, partner: { created_by?: string | null; relationship_manager_id?: string | null }) {
  if (await canReviewPartnerDocuments(viewer, partner)) return true;
  return (await approverStagesFor(viewer.userId)).length > 0;
}

async function payload(partnerId: string, viewerId: string, canManage: boolean) {
  const [partner, documents, approvers, myStages] = await Promise.all([
    findPartnerById(partnerId),
    listPartnerDocuments(partnerId),
    allStageApprovers(),
    approverStagesFor(viewerId)
  ]);
  const stage = partner?.approval_stage ?? null;
  return {
    documents,
    progress: onboardingProgress(documents),
    onboarded_at: partner?.onboarded_at ?? '',
    // False for an approver who is not this partner's creator/RM/manager —
    // the screen hides upload/edit controls they could not use anyway.
    canManage,
    approval: {
      stage,
      trail: partner?.approval_trail ?? [],
      approvers,
      canDecide: isPartnerApprovalStage(stage) && myStages.includes(stage)
    }
  };
}

async function notifyStageApprovers(stage: PartnerApprovalStage, partnerId: string, companyName: string) {
  const usernames = (await stageApprovers(stage)).map((a) => a.username);
  if (!usernames.length) return;
  await notifyUsers(usernames, {
    title: 'Partner onboarding awaiting your approval',
    body: `${companyName} — documents are ready for your review as ${PARTNER_APPROVAL_LABEL[stage]}.`,
    type: 'partner_approval_pending',
    entityType: 'partner_approval',
    entityId: partnerId
  });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const partner = await findPartnerById(id);
  if (!partner) return NextResponse.json({ error: 'Partner not found' }, { status: 404 });
  if (!(await canView(viewer, partner))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    return NextResponse.json(await payload(id, viewer.userId, await canReviewPartnerDocuments(viewer, partner)));
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

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const stage = body?.stage;
  const decision = body?.decision === 'rejected' ? 'rejected' : 'approved';
  const remarks = typeof body?.remarks === 'string' ? body.remarks : '';
  const rejectKinds = Array.isArray(body?.rejectKinds) ? (body!.rejectKinds as unknown[]).filter((k): k is string => typeof k === 'string' && isPartnerDocumentKind(k)) : [];
  if (!isPartnerApprovalStage(stage)) return NextResponse.json({ error: 'Unknown approval step.' }, { status: 400 });

  try {
    const result = await decideApprovalStage({ partnerId: id, stage, decision, reviewerId: viewer.userId, remarks, rejectKinds });
    const me = await findUserById(viewer.userId);
    const myName = me?.name || viewer.username;

    const partnerUsernames = (await listPartnerUsers(id)).filter((u) => u.status === 'active').map((u) => u.username);
    const ownerIds = [partner.created_by, partner.relationship_manager_id].filter((x): x is string => !!x && x !== viewer.userId);
    const ownerUsernames = (await Promise.all(ownerIds.map((uid) => findUserById(uid)))).filter(Boolean).map((u) => u!.username);

    if (decision === 'rejected') {
      if (partnerUsernames.length) {
        await notifyUsers(partnerUsernames, {
          title: 'Some documents need replacing',
          body: `Your onboarding documents were not accepted: ${remarks.trim()}`,
          type: 'partner_document_reviewed',
          entityType: 'partner',
          entityId: id
        });
      }
      if (ownerUsernames.length) {
        await notifyUsers(ownerUsernames, {
          title: 'Partner documents rejected',
          body: `${partner.company_name}: rejected by ${myName} (${PARTNER_APPROVAL_LABEL[stage]}) — ${remarks.trim()}`,
          type: 'partner_approval_rejected',
          entityType: 'partner_approval',
          entityId: id
        });
      }
    } else if (result.next === 'approved') {
      if (partnerUsernames.length) {
        await notifyUsers(partnerUsernames, {
          title: 'Your account is now fully active',
          body: 'All onboarding approvals are complete. The full partner portal is now open to you.',
          type: 'partner_document_reviewed',
          entityType: 'partner',
          entityId: id
        });
      }
      if (ownerUsernames.length) {
        await notifyUsers(ownerUsernames, {
          title: 'Partner fully approved',
          body: `${partner.company_name} has cleared Sales, Accounts and Admin approval and can start work.`,
          type: 'partner_approval_completed',
          entityType: 'partner_approval',
          entityId: id
        });
      }
    } else if (result.next) {
      await notifyStageApprovers(result.next, id, partner.company_name);
    }

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'partner',
      entityId: id,
      action: `Onboarding ${PARTNER_APPROVAL_LABEL[stage]} ${decision} for ${partner.company_name}`,
      previousStatus: stage,
      newStatus: result.next ?? 'returned_to_partner',
      remarks: remarks.trim() + (result.onboardingCompleted ? ' (onboarding completed)' : ''),
      ip: getClientIp(request)
    });

    return NextResponse.json(await payload(id, viewer.userId, await canReviewPartnerDocuments(viewer, partner)));
  } catch (error) {
    if (error instanceof PartnerApprovalError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return apiErrorResponse(error);
  }
}

// Upload a document on the partner's behalf — a signed agreement often
// reaches us by email first. Lands 'pending' like any other upload: it still
// has to go through the approval chain.
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
  if (files.some((f) => f.path.includes('..'))) {
    return NextResponse.json({ error: 'That file path is not acceptable.' }, { status: 400 });
  }

  try {
    await submitPartnerDocument({ partnerId: id, kind, files, submittedById: viewer.userId });
    const started = await startApprovalIfReady(id);
    if (started) await notifyStageApprovers(started, id, partner.company_name);

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'partner',
      entityId: id,
      action: `${PARTNER_DOCUMENT_LABEL[kind]} provided by our team for ${partner.company_name}`,
      previousStatus: '',
      newStatus: 'pending',
      remarks: started ? 'All documents in — sent for Sales Manager approval' : `${files.length} file${files.length === 1 ? '' : 's'}`,
      ip: getClientIp(request)
    });

    return NextResponse.json(await payload(id, viewer.userId, await canReviewPartnerDocuments(viewer, partner)));
  } catch (error) {
    if (error instanceof PartnerDocumentError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return apiErrorResponse(error);
  }
}
