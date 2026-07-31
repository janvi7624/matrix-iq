import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { demoScheduleStore } from '@/lib/demoScheduleStore';
import { appendProjectTimeline, findProjectById } from '@/lib/projectStore';
import { apiErrorResponse } from '@/lib/apiError';
import { DemoScheduleRecord, DomainKey } from '@/lib/types';

const VALID_DOMAINS: (DomainKey | '')[] = ['', 'av', 'robotics', 'ai', 'si', 'visitiq'];

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const records = await demoScheduleStore.list(viewer.username, viewer.isPrivileged);
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

  const clientName = typeof body.clientName === 'string' ? body.clientName.trim() : '';
  const scheduledAt = typeof body.scheduledAt === 'string' ? body.scheduledAt : '';
  const projectId = typeof body.projectId === 'string' ? body.projectId.trim() : '';
  if (!clientName || !scheduledAt || !projectId) {
    return NextResponse.json({ error: 'Project, client name, and scheduled date/time are required' }, { status: 400 });
  }

  const project = await findProjectById(projectId);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  if (!viewer.isPrivileged && project.created_by !== viewer.username) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const productDomain = VALID_DOMAINS.includes(body.productDomain) ? (body.productDomain as DomainKey | '') : '';

  // Every new request starts 'pending' regardless of what the client sends —
  // it only becomes 'confirmed'/'rejected' via the lead-approval PATCH below.
  const record: DemoScheduleRecord = {
    id: `${Date.now()}`,
    created_at: new Date().toISOString(),
    created_by: viewer.username,
    project_id: projectId,
    quotation_id: typeof body.quotationId === 'string' ? body.quotationId.trim() : '',
    client_name: clientName,
    company: typeof body.company === 'string' ? body.company.trim() : '',
    location: typeof body.location === 'string' ? body.location.trim() : '',
    product_domain: productDomain,
    technical_members: toStringArray(body.technicalMembers),
    scheduled_at: scheduledAt,
    assigned_rep: typeof body.assignedRep === 'string' && body.assignedRep.trim() ? body.assignedRep.trim() : viewer.username,
    status: 'pending',
    approved_by: '',
    approved_at: '',
    decision_note: '',
    notes: typeof body.notes === 'string' ? body.notes.trim() : '',
    demo_objective: typeof body.demoObjective === 'string' ? body.demoObjective.trim() : '',
    outcome: '',
    customer_rating: 0,
    key_queries: '',
    technical_challenges: '',
    unanswered_queries: '',
    suggested_next_action: '',
    next_follow_up_date: '',
    attachments: []
  };

  try {
    const created = await demoScheduleStore.create(record);
    await appendProjectTimeline(projectId, { by: viewer.username, stage: 'demo', label: `Demo requested for ${new Date(scheduledAt).toLocaleString('en-IN')}` }, 'demo');
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
