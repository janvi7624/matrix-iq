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
    request_code: '',
    status: 'draft',
    origin: typeof body.origin === 'string' ? body.origin.trim() : '',
    destination,
    start_date: startDate,
    end_date: typeof body.endDate === 'string' ? body.endDate : startDate,
    required_arrival_time: typeof body.requiredArrivalTime === 'string' ? body.requiredArrivalTime : '',
    expected_departure_time: typeof body.expectedDepartureTime === 'string' ? body.expectedDepartureTime : '',
    purpose: typeof body.purpose === 'string' ? body.purpose.trim() : '',
    linked_client: typeof body.linkedClient === 'string' ? body.linkedClient.trim() : '',
    expense_note: typeof body.expenseNote === 'string' ? body.expenseNote.trim() : '',
    project_id: typeof body.projectId === 'string' ? body.projectId : '',
    project_name: '',
    manager_id: '', manager_name: '', manager_action_at: '', manager_remarks: '',
    hr_reviewer_id: '', hr_reviewer_name: '', hr_reviewed_at: '', hr_remarks: '',
    hr_documents: [], estimated_cost: 0,
    admin_reviewer_id: '', admin_reviewer_name: '', admin_reviewed_at: '', admin_remarks: '',
    accounts_handler_id: '', accounts_handler_name: '', accounts_completed_at: '',
    booking_details: '', ticket_documents: [], actual_cost: 0,
    hr_final_verifier_id: '', hr_final_verifier_name: '', hr_final_verified_at: '', hr_final_remarks: '',
    companion_ids: Array.isArray(body.companionIds) ? body.companionIds.filter((v: unknown) => typeof v === 'string') : [],
    companion_names: [],
    change_request_remarks: '', change_requested_by: ''
  };

  try {
    const created = await travelScheduleStore.create(record);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error('[travel-schedule POST]', error);
    return apiErrorResponse(error);
  }
}
