import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { demoScheduleStore } from '@/lib/demoScheduleStore';
import { apiErrorResponse } from '@/lib/apiError';
import { DemoScheduleRecord } from '@/lib/types';

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
  if (!clientName || !scheduledAt) {
    return NextResponse.json({ error: 'Client name and scheduled date/time are required' }, { status: 400 });
  }

  const record: DemoScheduleRecord = {
    id: `${Date.now()}`,
    created_at: new Date().toISOString(),
    created_by: viewer.username,
    client_name: clientName,
    product_domain: typeof body.productDomain === 'string' ? body.productDomain.trim() : '',
    scheduled_at: scheduledAt,
    assigned_rep: typeof body.assignedRep === 'string' ? body.assignedRep.trim() : viewer.username,
    status: 'scheduled',
    notes: typeof body.notes === 'string' ? body.notes.trim() : ''
  };

  try {
    const created = await demoScheduleStore.create(record);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
