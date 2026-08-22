import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { projectStore } from '@/lib/projectStore';
import { apiErrorResponse } from '@/lib/apiError';
import { ProjectPriority, ProjectRecord } from '@/lib/types';
import { findUserById } from '@/lib/userStore';

const VALID_PRIORITY: ProjectPriority[] = ['low', 'medium', 'high'];

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const records = await projectStore.listLight(viewer.username, viewer.isPrivileged);
    return NextResponse.json(records);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // Engineer accounts only work projects they're assigned to — they don't
  // originate Sales projects. See projectStore's resolveOwnerWhere for the
  // matching visibility-side restriction.
  if (viewer.role === 'engineer') {
    return NextResponse.json({ error: 'Forbidden — engineer accounts can only view projects assigned to them' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const clientName = typeof body.clientName === 'string' ? body.clientName.trim() : '';
  const company = typeof body.company === 'string' ? body.company.trim() : '';
  if (!clientName && !company) {
    return NextResponse.json({ error: 'Client name or company is required' }, { status: 400 });
  }

  const now = new Date().toISOString();
  // Only a privileged role may attribute a project to someone else (e.g. an
  // Admin entering data on a sales rep's behalf) — otherwise created_by IS
  // the ownership/visibility key (see projectStore.list), so letting any
  // caller set it would let a plain "user" plant projects under another
  // employee's name or drop one into visibility limbo with a bogus name.
  const requestedSalesPerson = typeof body.salesPerson === 'string' && body.salesPerson.trim() ? body.salesPerson.trim() : '';
  const salesPerson = viewer.isPrivileged && requestedSalesPerson ? requestedSalesPerson : viewer.username;
  const assignedTechnicalPersonId = typeof body.assignedTechnicalPersonId === 'string' ? body.assignedTechnicalPersonId.trim() : '';
  const assignedTechnicalPerson = assignedTechnicalPersonId ? await findUserById(assignedTechnicalPersonId) : undefined;
  const record: ProjectRecord = {
    id: `${Date.now()}`,
    created_at: now,
    created_by: salesPerson,
    client_name: clientName,
    company,
    contact_person: typeof body.contactPerson === 'string' ? body.contactPerson.trim() : '',
    phone: typeof body.phone === 'string' ? body.phone.trim() : '',
    email: typeof body.email === 'string' ? body.email.trim() : '',
    address: typeof body.address === 'string' ? body.address.trim() : '',
    sales_person: salesPerson,
    source: typeof body.source === 'string' ? body.source.trim() : '',
    status: 'active',
    stage: 'cold_call',
    cold_call_responded: '',
    priority: VALID_PRIORITY.includes(body.priority) ? body.priority : 'medium',
    expected_closing_date: typeof body.expectedClosingDate === 'string' ? body.expectedClosingDate : '',
    next_follow_up_date: typeof body.nextFollowUpDate === 'string' ? body.nextFollowUpDate : '',
    remarks: typeof body.remarks === 'string' ? body.remarks.trim() : '',
    notes: [],
    attachments: [],
    assigned_technical_person_id: assignedTechnicalPerson ? assignedTechnicalPerson.id : '',
    assigned_technical_person_name: assignedTechnicalPerson ? assignedTechnicalPerson.name : '',
    timeline: [{ id: `${Date.now()}`, at: now, by: viewer.username, stage: 'created', label: 'Project created', remarks: '' }],
    updated_at: now
  };

  try {
    const created = await projectStore.create(record);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
