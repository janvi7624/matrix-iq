import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { leadStore, createOrMergeLead } from '@/lib/leadStore';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { DomainKey, LeadPriority } from '@/lib/types';

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

  const mobile = typeof body.mobile === 'string' ? body.mobile.trim() : '';
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

  try {
    // Same mobile/email already scanned by anyone — merge into that lead
    // instead of creating a duplicate (spec: two reps scanning the same card
    // at an event must not fork into two records).
    const result = await createOrMergeLead(
      { name, mobile, email, designation, company, city, cardImageUrl, interests, subInterests, followUpActions, priority, budget, notes, source: cardImageUrl ? 'business_card' : 'manual' },
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
      return NextResponse.json({ ...result.record, duplicate: true, duplicateCapturedBy: before.created_by }, { status: 200 });
    }

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
    return NextResponse.json(result.record, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
