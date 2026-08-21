import { NextRequest, NextResponse } from 'next/server';
import { getTmsViewer, isAdministrationManager } from '@/lib/tmsAccess';
import { tmsBomRequestStore } from '@/lib/tmsBomRequestStore';
import { apiErrorResponse } from '@/lib/apiError';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { notifyUsers } from '@/lib/notificationStore';
import { getAppConfig } from '@/lib/appConfigStore';

// approved -> admin_approved. Gated to whoever manages the "Administration"
// department (Department.managerIds) — see lib/tmsAccess.ts's
// isAdministrationManager.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getTmsViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await isAdministrationManager(viewer))) {
    return NextResponse.json({ error: 'Forbidden — only Administration can approve this request' }, { status: 403 });
  }

  const { id } = await params;
  try {
    const existing = await tmsBomRequestStore.findById(id);
    if (!existing) return NextResponse.json({ error: 'BOM request not found' }, { status: 404 });
    if (existing.status !== 'approved') {
      return NextResponse.json({ error: 'This request is not awaiting Administration approval' }, { status: 400 });
    }

    const updated = await tmsBomRequestStore.adminDecide(id, 'admin_approved', viewer.username);

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'tms_bom_request',
      entityId: id,
      action: 'BOM request approved by Administration',
      previousStatus: 'approved',
      newStatus: 'admin_approved',
      remarks: existing.item_name,
      ip: getClientIp(request)
    });

    const config = await getAppConfig();
    const notifyTargets = config.bomFinanceApproverUsername && config.bomFinanceApproverUsername !== viewer.username
      ? [config.bomFinanceApproverUsername]
      : [];
    if (notifyTargets.length) {
      await notifyUsers(notifyTargets, {
        title: 'BOM request awaiting Finance approval',
        body: `"${existing.item_name}" for ${existing.project_name} was approved by Administration (${viewer.username})`,
        type: 'tms_bom_request_admin_approved',
        entityType: 'tms_bom_request',
        entityId: id
      });
    }

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
