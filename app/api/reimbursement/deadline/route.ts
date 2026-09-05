import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { getEffectiveDeadline, extendDeadline } from '@/lib/reimbursementDeadlineStore';
import { listDepartmentManagers, findHrManagers } from '@/lib/departmentStore';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';

// Same permission gate as Reimbursement's own HR-review step
// (app/api/reimbursement/sheet/[id]/hr-decide/route.ts): HR department
// managers, plus admin/superadmin regardless of department.
async function resolveCanExtend(viewerUsername: string, viewerRole: string): Promise<boolean> {
  if (viewerRole === 'admin' || viewerRole === 'superadmin') return true;
  const allManagers = await listDepartmentManagers();
  return findHrManagers(allManagers).some((m) => m.username === viewerUsername);
}

// GET — the effective submission deadline for the current month, visible to
// every authenticated viewer (so the Reimbursement page can show it to
// everyone, not just whoever can change it).
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const today = new Date();
    const [deadline, canExtend] = await Promise.all([
      getEffectiveDeadline(today.getFullYear(), today.getMonth() + 1),
      resolveCanExtend(viewer.username, viewer.role)
    ]);
    return NextResponse.json({ ...deadline, canExtend });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

// POST — extend the CURRENT month's deadline.
export async function POST(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!(await resolveCanExtend(viewer.username, viewer.role))) {
    return NextResponse.json({ error: 'Not authorized — only HR managers or admins can extend the deadline' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const day = Number(body?.day);
  if (!body || !Number.isFinite(day) || day < 1 || day > 31) {
    return NextResponse.json({ error: 'A valid day of month (1-31) is required' }, { status: 400 });
  }

  try {
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth() + 1;
    const deadline = await extendDeadline(year, month, Math.round(day), viewer.username);

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'reimbursement_sheet',
      entityId: `${year}-${String(month).padStart(2, '0')}`,
      action: `Extended reimbursement deadline to day ${deadline.day}`,
      previousStatus: '',
      newStatus: '',
      ip: getClientIp(request)
    });

    return NextResponse.json({ ...deadline, canExtend: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
