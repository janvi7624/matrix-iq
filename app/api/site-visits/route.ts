import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { siteVisitStore } from '@/lib/siteVisitStore';
import { appendProjectTimeline, findProjectById, projectStore } from '@/lib/projectStore';
import { apiErrorResponse } from '@/lib/apiError';
import { DomainKey, ProjectRecord, SiteVisitRecord, VisitStage } from '@/lib/types';

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
  const contactPerson = typeof body.contactPerson === 'string' ? body.contactPerson.trim() : '';
  const clientEmail = typeof body.clientEmail === 'string' ? body.clientEmail.trim() : '';
  const clientPhone = typeof body.clientPhone === 'string' ? body.clientPhone.trim() : '';
  const location = typeof body.location === 'string' ? body.location.trim() : '';

  try {
    // Every site visit belongs to a Project. If the caller already has one
    // (e.g. logging a second visit, or a visit for a different domain with
    // the same client), link to it; otherwise a new Project is created
    // automatically so the pipeline always has a master record to attach to.
    let projectId = typeof body.projectId === 'string' ? body.projectId.trim() : '';
    if (projectId) {
      const project = await findProjectById(projectId);
      if (!project) projectId = '';
    }
    if (!projectId) {
      const now = new Date().toISOString();
      const newProject: ProjectRecord = {
        id: `${Date.now()}`,
        created_at: now,
        created_by: viewer.username,
        client_name: contactPerson,
        company: companyName,
        contact_person: contactPerson,
        phone: clientPhone,
        email: clientEmail,
        address: location,
        sales_person: viewer.username,
        source: '',
        status: 'active',
        stage: 'site_visit',
        cold_call_responded: '',
        priority: 'medium',
        expected_closing_date: '',
        next_follow_up_date: '',
        remarks: '',
        notes: [],
        attachments: [],
        assigned_technical_person_id: '',
        assigned_technical_person_name: '',
        timeline: [{ id: `${Date.now()}`, at: now, by: viewer.username, stage: 'created', label: 'Project created (from site visit)', remarks: '' }],
        updated_at: now
      };
      const createdProject = await projectStore.create(newProject);
      projectId = createdProject.id;
    }

    const now = new Date().toISOString();
    const record: SiteVisitRecord = {
      id: `${Date.now()}`,
      created_at: now,
      created_by: viewer.username,
      project_id: projectId,
      company_name: companyName,
      contact_person: contactPerson,
      client_email: clientEmail,
      client_phone: clientPhone,
      location,
      visit_date: visitDate,
      team_technical: toStringArray(body.teamTechnical),
      team_sales: toStringArray(body.teamSales),
      purpose: typeof body.purpose === 'string' ? body.purpose.trim() : '',
      category,
      products_interested: toStringArray(body.productsInterested),
      visit_details: typeof body.visitDetails === 'string' ? body.visitDetails.trim() : '',
      image_urls: toStringArray(body.imageUrls),
      action_plan: typeof body.actionPlan === 'string' ? body.actionPlan.trim() : '',
      reminder_date: typeof body.reminderDate === 'string' ? body.reminderDate : '',
      stage,
      status: 'open',
      updates: [],
      updated_at: now
    };

    const created = await siteVisitStore.create(record);
    await appendProjectTimeline(projectId, { by: viewer.username, stage: 'site_visit', label: `Site visit logged${location ? ` at ${location}` : ''}`, remarks: record.purpose });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
