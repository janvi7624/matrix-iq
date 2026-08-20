import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { demoScheduleStore } from '@/lib/demoScheduleStore';
import { appendProjectTimeline, findProjectById } from '@/lib/projectStore';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { DemoPriority, DemoProductLine, DemoScheduleRecord, DomainKey } from '@/lib/types';
import { findUserById } from '@/lib/userStore';
import { notifyUsers } from '@/lib/notificationStore';
import { isUserADepartmentManager } from '@/lib/departmentStore';
import { TMS_ROLE_KEYS } from '@/lib/tmsConstants';

const VALID_DOMAINS: DomainKey[] = ['av', 'robotics', 'ai', 'si', 'visitiq'];
const VALID_PRIORITY: DemoPriority[] = ['low', 'medium', 'high'];

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

function toDomainArray(value: unknown): DomainKey[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is DomainKey => VALID_DOMAINS.includes(v));
}

function toProductLines(value: unknown): DemoProductLine[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is { product: unknown; quantity: unknown } => v && typeof v === 'object')
    .map((v) => ({ product: typeof v.product === 'string' ? v.product.trim() : '', quantity: Math.max(1, Number(v.quantity) || 1) }))
    .filter((v) => v.product);
}

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    // Technical and Back Office act on demo requests routed to them by the
    // approval pipeline (pending_technical / pending_backoffice, etc.), not
    // ones they personally created — own-scoping them like a plain "user"
    // would leave their entire review queue empty. The technical-approval /
    // manager-approval / DC action routes are already role-gated (not
    // ownership-gated), so widening visibility here doesn't grant any new
    // write capability, only lets them see what they could already act on.
    const canSeeQueue =
      viewer.isPrivileged ||
      viewer.role === 'technical' ||
      viewer.role === 'backoffice' ||
      (TMS_ROLE_KEYS as readonly string[]).includes(viewer.role) ||
      (await isUserADepartmentManager(viewer.username));
    const records = await demoScheduleStore.list(viewer.username, canSeeQueue);
    return NextResponse.json(records);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // TMS accounts (technical-manager/team-lead/engineer/technician) can see
  // the demo queue (canSeeQueue above) but not submit new requests — that
  // stays a Sales-side action, same as before TMS gained visibility here.
  if ((TMS_ROLE_KEYS as readonly string[]).includes(viewer.role)) {
    return NextResponse.json({ error: 'Forbidden — view only for the Technical team' }, { status: 403 });
  }

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

  const productDomains = toDomainArray(body.productDomains);
  // Sales can "Save as Draft" (submit: false) or send it straight into the
  // approval pipeline (submit: true, the default).
  const status = body.submit === false ? 'draft' : 'pending_technical';

  // The picker now submits a real user id — resolve it to the person's
  // account and dual-write both the FK (routing/notifications/dashboard
  // matching) and the display name string (back-compat with anything that
  // still reads assigned_technical_person as plain text, e.g. PDFs). Falls
  // back to the legacy free-text field if a caller ever omits the id.
  const assignedTechnicalPersonId = typeof body.assignedTechnicalPersonId === 'string' ? body.assignedTechnicalPersonId.trim() : '';
  const assignedPerson = assignedTechnicalPersonId ? await findUserById(assignedTechnicalPersonId) : undefined;
  const assignedTechnicalPersonName = assignedPerson ? assignedPerson.name : typeof body.assignedTechnicalPerson === 'string' ? body.assignedTechnicalPerson.trim() : '';

  const record: DemoScheduleRecord = {
    id: `${Date.now()}`,
    created_at: new Date().toISOString(),
    created_by: viewer.username,
    project_id: projectId,
    quotation_id: typeof body.quotationId === 'string' ? body.quotationId.trim() : '',
    client_name: clientName,
    company: typeof body.company === 'string' ? body.company.trim() : '',
    location: typeof body.location === 'string' ? body.location.trim() : '',
    product_domains: productDomains,
    products_demonstrated: [],
    products_required: toProductLines(body.productsRequired),
    priority: VALID_PRIORITY.includes(body.priority) ? body.priority : 'medium',
    assigned_technical_person: assignedTechnicalPersonName,
    assigned_technical_person_id: assignedPerson ? assignedPerson.id : '',
    technical_members: toStringArray(body.technicalMembers),
    scheduled_at: scheduledAt,
    assigned_rep: typeof body.assignedRep === 'string' && body.assignedRep.trim() ? body.assignedRep.trim() : viewer.username,
    status,
    technical_approval: { decision: '', availability: '', remarks: '', expected_arrival_time: '', decided_by: '', decided_at: '' },
    manager_approval: { decision: '', remarks: '', reassigned_engineer: '', decided_by: '', decided_at: '' },
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

    if (assignedPerson && status === 'pending_technical') {
      await notifyUsers([assignedPerson.username], {
        title: 'New demo request needs your confirmation',
        body: `${clientName}${record.company ? ` (${record.company})` : ''} — scheduled ${new Date(scheduledAt).toLocaleString('en-IN')}`,
        type: 'demo_technical_confirmation',
        entityType: 'demo',
        entityId: created.id
      });
    }

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'demo',
      entityId: created.id,
      action: status === 'draft' ? 'Saved demo request as draft' : 'Created demo request',
      previousStatus: '',
      newStatus: status,
      remarks: '',
      ip: getClientIp(request)
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
