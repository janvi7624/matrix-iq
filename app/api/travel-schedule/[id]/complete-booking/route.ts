import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { travelScheduleStore } from '@/lib/travelScheduleStore';
import { logAudit } from '@/lib/auditLogStore';
import { notifyUsers } from '@/lib/notificationStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { listDepartmentManagers } from '@/lib/departmentStore';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  try {
    const existing = await travelScheduleStore.findById(id);
    if (!existing) return NextResponse.json({ error: 'Travel request not found' }, { status: 404 });
    if (existing.status !== 'admin_approved') {
      return NextResponse.json({ error: 'This request is not ready for ticket booking' }, { status: 400 });
    }

    // Authorization: Accounts department managers or admin/superadmin override
    const isOverride = viewer.role === 'admin' || viewer.role === 'superadmin';
    if (!isOverride) {
      const accountsManagers = (await listDepartmentManagers())['Accounts'] || [];
      const isAccountsManager = accountsManagers.some((m) => m.username === viewer.username);
      if (!isAccountsManager && !viewer.isPrivileged) {
        return NextResponse.json({ error: 'Only the Accounts team can complete ticket booking' }, { status: 403 });
      }
    }

    const bookingDetails = typeof body.bookingDetails === 'string' ? body.bookingDetails.trim() : '';
    const ticketDocuments = Array.isArray(body.ticketDocuments) ? body.ticketDocuments : [];
    const actualCost = typeof body.actualCost === 'number' ? body.actualCost : undefined;

    const updated = await travelScheduleStore.completeBooking(id, viewer.username, {
      booking_details: bookingDetails, ticket_documents: ticketDocuments, actual_cost: actualCost
    });

    await logAudit({
      by: viewer.username, role: viewer.role, entityType: 'travel_schedule', entityId: id,
      action: 'complete_booking', previousStatus: existing.status, newStatus: 'ticket_booking', ip: getClientIp(request)
    });

    // Notify HR for final verification
    const hrManagers = (await listDepartmentManagers())['HR'] || [];
    if (hrManagers.length) {
      await notifyUsers(hrManagers.map((m) => m.username), {
        title: 'Travel booking complete — needs final verification',
        body: `Tickets booked for ${existing.created_by}'s travel (${existing.origin} → ${existing.destination})`,
        type: 'travel_hr_final_verify', entityType: 'travel_schedule', entityId: id
      });
    }

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
