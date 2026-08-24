import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { travelScheduleStore } from '@/lib/travelScheduleStore';
import { logAudit } from '@/lib/auditLogStore';
import { notifyUsers } from '@/lib/notificationStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { listDepartmentManagers } from '@/lib/departmentStore';
import { findUserByUsername } from '@/lib/userStore';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    const existing = await travelScheduleStore.findById(id);
    if (!existing) return NextResponse.json({ error: 'Travel request not found' }, { status: 404 });
    if (existing.status !== 'draft' && existing.status !== 'changes_requested') {
      return NextResponse.json({ error: 'Only draft or change-requested entries can be submitted' }, { status: 400 });
    }
    if (existing.created_by !== viewer.username && !viewer.isPrivileged) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    const allManagers = await listDepartmentManagers();
    const user = await findUserByUsername(viewer.username);
    const creatorDept = user?.department || '';

    // Determine which stage to skip to based on creator's role:
    // - If creator IS a department manager → skip manager stage, go to HR
    // - If creator IS an HR manager → skip manager + HR, go to Admin
    // - If creator IS an admin manager → skip manager + HR + Admin, go to Accounts
    const deptManagers = creatorDept ? (allManagers[creatorDept] || []) : [];
    const isCreatorDeptManager = deptManagers.some((m) => m.username === viewer.username);
    const isCreatorHrManager = (allManagers['HR'] || []).some((m) => m.username === viewer.username);
    const isCreatorAdminManager = (allManagers['Admin'] || allManagers['Administration'] || []).some((m) => m.username === viewer.username);

    let targetStatus = 'submitted'; // default: awaiting manager approval
    let notifyDept = '';
    let notifyType = '';
    let notifyTitle = '';

    if (isCreatorAdminManager) {
      // Admin manager → skip to Accounts (ticket booking)
      targetStatus = 'admin_approved';
      notifyDept = 'Accounts';
      notifyType = 'travel_ticket_booking';
      notifyTitle = 'Travel request ready for ticket booking';
    } else if (isCreatorHrManager) {
      // HR manager → skip to Admin
      targetStatus = 'hr_reviewed';
      notifyDept = 'Admin';
      notifyType = 'travel_admin_review';
      notifyTitle = 'Travel request needs admin approval';
    } else if (isCreatorDeptManager) {
      // Department manager → skip to HR
      targetStatus = 'manager_approved';
      notifyDept = 'HR';
      notifyType = 'travel_hr_review';
      notifyTitle = 'Travel request needs HR review';
    }

    // Apply the appropriate status
    let updated;
    if (targetStatus === 'submitted') {
      updated = await travelScheduleStore.submit(id);
    } else {
      updated = await travelScheduleStore.update(id, {
        status: targetStatus,
        change_request_remarks: '',
        change_requested_by: ''
      } as never);
    }

    await logAudit({
      by: viewer.username, role: viewer.role, entityType: 'travel_schedule', entityId: id,
      action: 'submit', previousStatus: existing.status, newStatus: targetStatus,
      remarks: targetStatus !== 'submitted' ? `Auto-advanced (creator is ${creatorDept} manager)` : '',
      ip: getClientIp(request)
    });

    // Send notifications to the correct next stage
    if (notifyDept) {
      const nextManagers = allManagers[notifyDept] || allManagers[`${notifyDept}istration`] || [];
      if (nextManagers.length) {
        await notifyUsers(nextManagers.map((m) => m.username), {
          title: notifyTitle,
          body: `${viewer.name}'s travel request (${existing.origin} → ${existing.destination})`,
          type: notifyType, entityType: 'travel_schedule', entityId: id
        });
      }
    } else {
      // Normal flow: notify creator's department manager
      if (creatorDept) {
        const managers = allManagers[creatorDept] || [];
        if (managers.length) {
          await notifyUsers(managers.map((m) => m.username), {
            title: 'Travel request needs your approval',
            body: `${viewer.name} submitted a travel request: ${existing.origin} → ${existing.destination}`,
            type: 'travel_manager_approval', entityType: 'travel_schedule', entityId: id
          });
        }
      }
    }

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
