import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { leadStore, findDuplicateLead } from '@/lib/leadStore';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { DomainKey, LeadPriority, LeadRecord } from '@/lib/types';

function unionStrings(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])];
}

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

  const now = new Date().toISOString();
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
    const duplicate = await findDuplicateLead(mobile, email);
    if (duplicate) {
      const merged = await leadStore.update(duplicate.id, {
        name: name || duplicate.name,
        company: company || duplicate.company,
        mobile: mobile || duplicate.mobile,
        email: email || duplicate.email,
        designation: designation || duplicate.designation,
        city: city || duplicate.city,
        card_image_url: cardImageUrl || duplicate.card_image_url,
        interests: unionStrings(duplicate.interests, interests) as DomainKey[],
        sub_interests: unionStrings(duplicate.sub_interests, subInterests),
        follow_up_actions: unionStrings(duplicate.follow_up_actions, followUpActions),
        priority: priority || duplicate.priority,
        budget: budget || duplicate.budget,
        notes: notes ? (duplicate.notes ? `${duplicate.notes}\n---\n${notes}` : notes) : duplicate.notes,
        updated_at: now
      });
      await logAudit({
        by: viewer.username,
        role: viewer.role,
        entityType: 'lead',
        entityId: duplicate.id,
        action: `Lead re-scanned & merged (already captured by ${duplicate.created_by}): ${merged?.name || merged?.company}`,
        previousStatus: duplicate.priority || 'unrated',
        newStatus: merged?.priority || 'unrated',
        ip: getClientIp(request)
      });
      return NextResponse.json({ ...merged, duplicate: true, duplicateCapturedBy: duplicate.created_by }, { status: 200 });
    }

    const record: LeadRecord = {
      id: `${Date.now()}`,
      created_at: now,
      created_by: viewer.username,
      updated_at: now,
      name,
      mobile,
      email,
      designation,
      company,
      city,
      card_image_url: cardImageUrl,
      interests,
      sub_interests: subInterests,
      priority,
      follow_up_actions: followUpActions,
      budget,
      notes,
      project_id: '',
      crm_id: ''
    };
    const created = await leadStore.create(record);
    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'lead',
      entityId: created.id,
      action: `Lead captured: ${created.name || created.company}`,
      previousStatus: '',
      newStatus: created.priority || 'unrated',
      ip: getClientIp(request)
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
