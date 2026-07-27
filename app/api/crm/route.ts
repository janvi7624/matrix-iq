import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { crmStore } from '@/lib/crmStore';
import { apiErrorResponse } from '@/lib/apiError';
import { CrmRecord } from '@/lib/types';

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const records = await crmStore.list(viewer.username, viewer.isPrivileged);
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

  const company = typeof body.company === 'string' ? body.company.trim() : '';
  const contactPerson = typeof body.contactPerson === 'string' ? body.contactPerson.trim() : '';
  if (!company && !contactPerson) {
    return NextResponse.json({ error: 'Company or contact person is required' }, { status: 400 });
  }

  const record: CrmRecord = {
    id: `${Date.now()}`,
    created_at: new Date().toISOString(),
    created_by: viewer.username,
    company,
    contact_person: contactPerson,
    phone: typeof body.phone === 'string' ? body.phone.trim() : '',
    email: typeof body.email === 'string' ? body.email.trim() : '',
    status: body.status === 'prospect' || body.status === 'customer' ? body.status : 'lead',
    source: typeof body.source === 'string' ? body.source.trim() : '',
    notes: typeof body.notes === 'string' ? body.notes.trim() : ''
  };

  try {
    const created = await crmStore.create(record);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
