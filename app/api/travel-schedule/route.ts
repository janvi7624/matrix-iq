import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { travelScheduleStore } from '@/lib/travelScheduleStore';
import { apiErrorResponse } from '@/lib/apiError';
import { TravelScheduleRecord } from '@/lib/types';

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const records = await travelScheduleStore.list(viewer.username, viewer.isPrivileged);
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

  const destination = typeof body.destination === 'string' ? body.destination.trim() : '';
  const startDate = typeof body.startDate === 'string' ? body.startDate : '';
  if (!destination || !startDate) {
    return NextResponse.json({ error: 'Destination and start date are required' }, { status: 400 });
  }

  const record: TravelScheduleRecord = {
    id: `${Date.now()}`,
    created_at: new Date().toISOString(),
    created_by: viewer.username,
    origin: typeof body.origin === 'string' ? body.origin.trim() : '',
    destination,
    start_date: startDate,
    end_date: typeof body.endDate === 'string' ? body.endDate : startDate,
    purpose: typeof body.purpose === 'string' ? body.purpose.trim() : '',
    linked_client: typeof body.linkedClient === 'string' ? body.linkedClient.trim() : '',
    expense_note: typeof body.expenseNote === 'string' ? body.expenseNote.trim() : ''
  };

  try {
    const created = await travelScheduleStore.create(record);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
