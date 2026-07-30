import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { siteVisitStore } from '@/lib/siteVisitStore';
import { apiErrorResponse } from '@/lib/apiError';
import { DomainKey, SiteVisitRecord, SiteVisitUpdateEntry, VisitStage } from '@/lib/types';

const VALID_CATEGORIES: (DomainKey | '')[] = ['', 'av', 'robotics', 'ai', 'si', 'visitiq'];
const VALID_STAGES: (VisitStage | '')[] = ['', 'hot', 'warm', 'cold'];

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  try {
    const records = await siteVisitStore.list(viewer.username, true);
    const existing = records.find((r) => r.id === id);
    if (!existing) return NextResponse.json({ error: 'Site visit not found' }, { status: 404 });
    if (!viewer.isPrivileged && existing.created_by !== viewer.username) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const patch: Partial<SiteVisitRecord> = { updated_at: new Date().toISOString() };

    if (body.action === 'addUpdate') {
      const projectDetails = typeof body.projectDetails === 'string' ? body.projectDetails.trim() : '';
      const ongoingActivities = typeof body.ongoingActivities === 'string' ? body.ongoingActivities.trim() : '';
      if (!projectDetails && !ongoingActivities) {
        return NextResponse.json({ error: 'Project details or ongoing activities are required' }, { status: 400 });
      }
      const entry: SiteVisitUpdateEntry = {
        id: `${Date.now()}`,
        updated_at: new Date().toISOString(),
        updated_by: viewer.username,
        team_technical: toStringArray(body.teamTechnical),
        team_sales: toStringArray(body.teamSales),
        project_details: projectDetails,
        ongoing_activities: ongoingActivities
      };
      patch.updates = [...existing.updates, entry];
    } else {
      if (typeof body.companyName === 'string' && body.companyName.trim()) patch.company_name = body.companyName.trim();
      if (typeof body.contactPerson === 'string') patch.contact_person = body.contactPerson.trim();
      if (typeof body.clientEmail === 'string') patch.client_email = body.clientEmail.trim();
      if (typeof body.clientPhone === 'string') patch.client_phone = body.clientPhone.trim();
      if (typeof body.visitDate === 'string' && body.visitDate) patch.visit_date = body.visitDate;
      if (Array.isArray(body.teamTechnical)) patch.team_technical = toStringArray(body.teamTechnical);
      if (Array.isArray(body.teamSales)) patch.team_sales = toStringArray(body.teamSales);
      if (typeof body.purpose === 'string') patch.purpose = body.purpose.trim();
      if (VALID_CATEGORIES.includes(body.category)) patch.category = body.category as DomainKey | '';
      if (typeof body.visitDetails === 'string') patch.visit_details = body.visitDetails.trim();
      if (Array.isArray(body.imageUrls)) patch.image_urls = toStringArray(body.imageUrls);
      if (typeof body.actionPlan === 'string') patch.action_plan = body.actionPlan.trim();
      if (typeof body.reminderDate === 'string') patch.reminder_date = body.reminderDate;
      if (VALID_STAGES.includes(body.stage)) patch.stage = body.stage as VisitStage | '';
      if (body.status === 'open' || body.status === 'closed') patch.status = body.status;
    }

    const updated = await siteVisitStore.update(id, patch);
    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    const deleted = await siteVisitStore.remove(id, viewer.username, viewer.isPrivileged);
    if (!deleted) return NextResponse.json({ error: 'Site visit not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
