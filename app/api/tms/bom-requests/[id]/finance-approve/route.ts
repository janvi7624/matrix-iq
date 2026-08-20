import { NextRequest, NextResponse } from 'next/server';
import { getTmsViewer, isBomFinanceApprover } from '@/lib/tmsAccess';
import { tmsBomRequestStore } from '@/lib/tmsBomRequestStore';
import { apiErrorResponse } from '@/lib/apiError';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { notifyUsers } from '@/lib/notificationStore';
import { listDepartmentManagers } from '@/lib/departmentStore';

// approved -> finance_approved. Gated to the configured Finance Approver
// (AppConfig.bomFinanceApproverId, Application Settings), not a role — see
// lib/tmsAccess.ts's isBomFinanceApprover.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getTmsViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await isBomFinanceApprover(viewer))) {
    return NextResponse.json({ error: 'Forbidden — only the configured Finance Approver can approve this request' }, { status: 403 });
  }

  const { id } = await params;
  try {
    const existing = await tmsBomRequestStore.findById(id);
    if (!existing) return NextResponse.json({ error: 'BOM request not found' }, { status: 404 });
    if (existing.status !== 'approved') {
      return NextResponse.json({ error: 'This request is not awaiting Finance approval' }, { status: 400 });
    }

    const updated = await tmsBomRequestStore.financeDecide(id, 'finance_approved', viewer.username);

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'tms_bom_request',
      entityId: id,
      action: 'BOM request finance-approved',
      previousStatus: 'approved',
      newStatus: 'finance_approved',
      remarks: existing.item_name,
      ip: getClientIp(request)
    });

    const accountsManagers = (await listDepartmentManagers())['Accounts'] || [];
    const notifyTargets = accountsManagers.map((m) => m.username).filter((u) => u && u !== viewer.username);
    if (notifyTargets.length) {
      await notifyUsers(notifyTargets, {
        title: 'BOM request awaiting payment',
        body: `"${existing.item_name}" for ${existing.project_name} was finance-approved by ${viewer.username}`,
        type: 'tms_bom_request_finance_approved',
        entityType: 'tms_bom_request',
        entityId: id
      });
    }

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
