import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { siteVisitStore } from '@/lib/siteVisitStore';
import { apiErrorResponse } from '@/lib/apiError';
import { SiteVisitRecord } from '@/lib/types';

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

  const clientName = typeof body.clientName === 'string' ? body.clientName.trim() : '';
  const visitDate = typeof body.visitDate === 'string' ? body.visitDate : '';
  if (!clientName || !visitDate) {
    return NextResponse.json({ error: 'Client name and visit date are required' }, { status: 400 });
  }

  const now = new Date().toISOString();
  const record: SiteVisitRecord = {
    id: `${Date.now()}`,
    created_at: now,
    created_by: viewer.username,
    client_name: clientName,
    client_company: typeof body.clientCompany === 'string' ? body.clientCompany.trim() : '',
    address: typeof body.address === 'string' ? body.address.trim() : '',
    visit_date: visitDate,
    attendees: typeof body.attendees === 'string' ? body.attendees.trim() : '',
    findings: typeof body.findings === 'string' ? body.findings.trim() : '',
    linked_quotation_number: typeof body.linkedQuotationNumber === 'string' ? body.linkedQuotationNumber.trim() : '',
    status: body.status === 'completed' || body.status === 'cancelled' ? body.status : 'scheduled',
    next_steps: typeof body.nextSteps === 'string' ? body.nextSteps.trim() : '',
    updated_at: now
  };

  try {
    const created = await siteVisitStore.create(record);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
