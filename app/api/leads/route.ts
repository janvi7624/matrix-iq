import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { leadStore, createOrMergeLead } from '@/lib/leadStore';
import { findHandoverRecipient, handOverCapturedLead } from '@/lib/leadHandover';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { DomainKey, LeadPriority } from '@/lib/types';
import { isLeadOrigin } from '@/lib/leadSources';

const VALID_DOMAINS: DomainKey[] = ['av', 'robotics', 'ai', 'si', 'visitiq'];
const VALID_PRIORITIES: LeadPriority[] = ['hot', 'warm', 'cool', ''];

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const records = await leadStore.list(viewer.username, viewer.isPrivileged);
    return NextResponse.json(records);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const company = typeof body.company === 'string' ? body.company.trim() : '';
  if (!name && !company) {
    return NextResponse.json({ error: 'Name or company is required' }, { status: 400 });
  }

  // Mandatory, and checked here rather than only in the wizard: a lead with no
  // origin is invisible to every "how did InfoComm do" question the pipeline
  // exists to answer, and backfilling it later means guessing.
  const leadSource = typeof body.leadSource === 'string' ? body.leadSource.trim() : '';
  if (!isLeadOrigin(leadSource)) {
    return NextResponse.json({ error: 'Pick where this lead came from.' }, { status: 400 });
  }

  const mobile = typeof body.mobile === 'string' ? body.mobile.trim() : '';
  const altMobile = typeof body.altMobile === 'string' ? body.altMobile.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
  const interests: DomainKey[] = Array.isArray(body.interests) ? body.interests.filter((d: unknown): d is DomainKey => VALID_DOMAINS.includes(d as DomainKey)) : [];
  const subInterests: string[] = Array.isArray(body.subInterests) ? body.subInterests.filter((s: unknown): s is string => typeof s === 'string') : [];
  const followUpActions: string[] = Array.isArray(body.followUpActions) ? body.followUpActions.filter((s: unknown): s is string => typeof s === 'string') : [];
  const priority: LeadPriority = VALID_PRIORITIES.includes(body.priority) ? body.priority : '';
  const designation = typeof body.designation === 'string' ? body.designation.trim() : '';
  const city = typeof body.city === 'string' ? body.city.trim() : '';
  const cardImageUrl = typeof body.cardImageUrl === 'string' ? body.cardImageUrl : '';
  const budget = typeof body.budget === 'string' ? body.budget.trim() : '';
  // "Whose lead is this?" on the Confirm Details step — '' leaves the lead
  // unassigned, exactly as before.
  const handoverToId = typeof body.handoverToId === 'string' ? body.handoverToId.trim() : '';

  try {
    // Checked before anything is written, so a bad pick is refused outright
    // instead of saving the lead and then failing to route it.
    const recipient = handoverToId ? await findHandoverRecipient(handoverToId, viewer) : null;
    if (handoverToId && !recipient) {
      return NextResponse.json({ error: 'That person can’t receive leads. Pick someone else, or leave it Unassigned.' }, { status: 400 });
    }

    // Same mobile/email already scanned by anyone — merge into that lead
    // instead of creating a duplicate (spec: two reps scanning the same card
    // at an event must not fork into two records).
    const result = await createOrMergeLead(
      { name, mobile, altMobile, email, designation, company, city, cardImageUrl, interests, subInterests, followUpActions, priority, budget, notes, source: cardImageUrl ? 'business_card' : 'manual', leadSource: leadSource },
      viewer.username
    );

    if (result.merged) {
      const before = result.duplicateBefore!;
      await logAudit({
        by: viewer.username,
        role: viewer.role,
        entityType: 'lead',
        entityId: before.id,
        action: `Lead re-scanned & merged (already captured by ${before.created_by}): ${result.record.name || result.record.company}`,
        previousStatus: before.priority || 'unrated',
        newStatus: result.record.priority || 'unrated',
        ip: getClientIp(request)
      });
    } else {
      await logAudit({
        by: viewer.username,
        role: viewer.role,
        entityType: 'lead',
        entityId: result.record.id,
        action: `Lead captured: ${result.record.name || result.record.company}`,
        previousStatus: '',
        newStatus: result.record.priority || 'unrated',
        ip: getClientIp(request)
      });
    }

    const handover = recipient ? await handOverCapturedLead(result.record, recipient, viewer, getClientIp(request)) : null;
    const record = handover ? handover.record : result.record;

    if (result.merged) {
      return NextResponse.json({ ...record, duplicate: true, duplicateCapturedBy: result.duplicateBefore!.created_by, handover: handover?.outcome }, { status: 200 });
    }
    return NextResponse.json({ ...record, handover: handover?.outcome }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
