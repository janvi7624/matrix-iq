import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { travelScheduleStore } from '@/lib/travelScheduleStore';
import { listAuditLog } from '@/lib/auditLogStore';
import { apiErrorResponse } from '@/lib/apiError';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    const record = await travelScheduleStore.findById(id);
    if (!record) return NextResponse.json({ error: 'Travel request not found' }, { status: 404 });
    const auditHistory = await listAuditLog('travel_schedule', id);
    return NextResponse.json({ ...record, audit_history: auditHistory });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  try {
    const existing = await travelScheduleStore.findById(id);
    if (!existing) return NextResponse.json({ error: 'Travel request not found' }, { status: 404 });
    if (existing.status !== 'draft' && existing.status !== 'changes_requested') {
      return NextResponse.json({ error: 'Can only edit draft or change-requested entries' }, { status: 400 });
    }
    if (existing.created_by !== viewer.username && !viewer.isPrivileged) {
      return NextResponse.json({ error: 'Not authorized to edit this request' }, { status: 403 });
    }

    const patch: Record<string, unknown> = {};
    if (typeof body.origin === 'string') patch.origin = body.origin.trim();
    if (typeof body.destination === 'string') patch.destination = body.destination.trim();
    if (typeof body.startDate === 'string') patch.start_date = body.startDate;
    if (typeof body.endDate === 'string') patch.end_date = body.endDate;
    if (typeof body.requiredArrivalTime === 'string') patch.required_arrival_time = body.requiredArrivalTime;
    if (typeof body.expectedDepartureTime === 'string') patch.expected_departure_time = body.expectedDepartureTime;
    if (typeof body.purpose === 'string') patch.purpose = body.purpose.trim();
    if (typeof body.linkedClient === 'string') patch.linked_client = body.linkedClient.trim();
    if (typeof body.expenseNote === 'string') patch.expense_note = body.expenseNote.trim();
    if (typeof body.projectId === 'string') patch.project_id = body.projectId;

    const updated = await travelScheduleStore.update(id, patch as never);
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
    const existing = await travelScheduleStore.findById(id);
    if (!existing) return NextResponse.json({ error: 'Travel entry not found' }, { status: 404 });

    const isAdmin = viewer.role === 'admin' || viewer.role === 'superadmin';
    if (!isAdmin) {
      return NextResponse.json({ error: 'Only admins can delete travel requests' }, { status: 403 });
    }

    const deleted = await travelScheduleStore.remove(id, true);
    if (!deleted) return NextResponse.json({ error: 'Could not delete' }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
