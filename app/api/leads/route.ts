import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { leadStore } from '@/lib/leadStore';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { DomainKey, LeadPriority, LeadRecord } from '@/lib/types';

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
  const record: LeadRecord = {
    id: `${Date.now()}`,
    created_at: now,
    created_by: viewer.username,
    updated_at: now,
    name,
    mobile: typeof body.mobile === 'string' ? body.mobile.trim() : '',
    email: typeof body.email === 'string' ? body.email.trim() : '',
    designation: typeof body.designation === 'string' ? body.designation.trim() : '',
    company,
    city: typeof body.city === 'string' ? body.city.trim() : '',
    card_image_url: typeof body.cardImageUrl === 'string' ? body.cardImageUrl : '',
    interests: Array.isArray(body.interests) ? body.interests.filter((d: unknown): d is DomainKey => VALID_DOMAINS.includes(d as DomainKey)) : [],
    sub_interests: Array.isArray(body.subInterests) ? body.subInterests.filter((s: unknown): s is string => typeof s === 'string') : [],
    priority: VALID_PRIORITIES.includes(body.priority) ? body.priority : '',
    follow_up_actions: Array.isArray(body.followUpActions) ? body.followUpActions.filter((s: unknown): s is string => typeof s === 'string') : [],
    budget: typeof body.budget === 'string' ? body.budget.trim() : '',
    notes: typeof body.notes === 'string' ? body.notes.trim() : '',
    project_id: '',
    crm_id: ''
  };

  try {
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
