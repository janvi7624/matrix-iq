import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { siteVisitStore } from '@/lib/siteVisitStore';
import { apiErrorResponse } from '@/lib/apiError';
import { DomainKey, SiteVisitRecord, VisitStage } from '@/lib/types';

const VALID_CATEGORIES: (DomainKey | '')[] = ['', 'av', 'robotics', 'ai', 'si', 'visitiq'];
const VALID_STAGES: (VisitStage | '')[] = ['', 'hot', 'warm', 'cold'];

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const records = await siteVisitStore.list(viewer.username, viewer.isPrivileged);
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

  const companyName = typeof body.companyName === 'string' ? body.companyName.trim() : '';
  const visitDate = typeof body.visitDate === 'string' ? body.visitDate : '';
  if (!companyName || !visitDate) {
    return NextResponse.json({ error: 'Company name and visit date are required' }, { status: 400 });
  }

  const category = VALID_CATEGORIES.includes(body.category) ? (body.category as DomainKey | '') : '';
  const stage = VALID_STAGES.includes(body.stage) ? (body.stage as VisitStage | '') : '';

  const now = new Date().toISOString();
  const record: SiteVisitRecord = {
    id: `${Date.now()}`,
    created_at: now,
    created_by: viewer.username,
    company_name: companyName,
    contact_person: typeof body.contactPerson === 'string' ? body.contactPerson.trim() : '',
    client_email: typeof body.clientEmail === 'string' ? body.clientEmail.trim() : '',
    client_phone: typeof body.clientPhone === 'string' ? body.clientPhone.trim() : '',
    visit_date: visitDate,
    team_technical: toStringArray(body.teamTechnical),
    team_sales: toStringArray(body.teamSales),
    purpose: typeof body.purpose === 'string' ? body.purpose.trim() : '',
    category,
    visit_details: typeof body.visitDetails === 'string' ? body.visitDetails.trim() : '',
    image_urls: toStringArray(body.imageUrls),
    action_plan: typeof body.actionPlan === 'string' ? body.actionPlan.trim() : '',
    reminder_date: typeof body.reminderDate === 'string' ? body.reminderDate : '',
    stage,
    status: 'open',
    updates: [],
    updated_at: now
  };

  try {
    const created = await siteVisitStore.create(record);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
