import { NextRequest, NextResponse } from 'next/server';
import { getTmsViewer, isAdministrationManager } from '@/lib/tmsAccess';
import { tmsBomRequestStore } from '@/lib/tmsBomRequestStore';
import { apiErrorResponse } from '@/lib/apiError';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { notifyUsers } from '@/lib/notificationStore';
import { sendProcurementLifecycleEmail } from '@/lib/email/notifications';
import { findUsersByDepartmentName, findUsersByUsernames } from '@/lib/userStore';
import { listDepartmentManagers } from '@/lib/departmentStore';
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

    // Who holds it next depends on whether a Finance Approver exists.
    //
    // This used to notify the configured finance approver and nobody else —
    // so with AppConfig.bomFinanceApproverId unset (its live state) a
    // management-approved request notified NOBODY, and could then only be
    // moved by an admin, since both the Finance gate and the payment gate
    // required a stage this org has no owner for. The request just stopped.
    //
    // With no Finance Approver configured the chain is
    // Department Manager -> Management -> Accounts, so Accounts is told it
    // is theirs to pay. Configure one and the Finance step comes back.
    const config = await getAppConfig();
    const financeStageEnabled = !!config.bomFinanceApproverUsername;

    const nextUp = financeStageEnabled
      ? {
          usernames: [config.bomFinanceApproverUsername],
          title: 'BOQ request awaiting Finance approval',
          event: 'bom_admin_approved' as const,
          type: 'tms_bom_request_admin_approved'
        }
      : {
          // Full Accounts roster, not only its configured manager — the same
          // reason finance-approve/ gives: Department.managerIds['Accounts']
          // misses the people who actually process payments.
          usernames: Array.from(
            new Set([
              ...(await findUsersByDepartmentName('Accounts')).map((u) => u.username),
              ...((await listDepartmentManagers())['Accounts'] || []).map((m) => m.username)
            ])
          ),
          title: 'BOQ request awaiting payment',
          event: 'bom_finance_approved' as const,
          type: 'tms_bom_request_finance_approved'
        };

    const notifyTargets = nextUp.usernames.filter((username) => username && username !== viewer.username);
    if (notifyTargets.length) {
      await notifyUsers(notifyTargets, {
        title: nextUp.title,
        body: `"${existing.item_name}" for ${existing.project_name} was approved by Management (${viewer.username})`,
        type: nextUp.type,
        entityType: 'tms_bom_request',
        entityId: id
      });
      const recipients = await findUsersByUsernames(notifyTargets);
      recipients.forEach((recipient) => {
        if (!recipient.email) return;
        void sendProcurementLifecycleEmail({
          name: recipient.name,
          email: recipient.email,
          urlPath: `/tms/bom-requests/${id}`,
          event: nextUp.event,
          itemLabel: existing.item_name,
          projectName: existing.project_name,
          detail: `Approved by Management (${viewer.username})`
        });
      });
    }

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
