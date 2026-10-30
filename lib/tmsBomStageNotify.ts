import { findBomStageOneApprovers } from './tmsAccess';
import { notifyUsers } from './notificationStore';
import { sendProcurementLifecycleEmail } from './email/notifications';
import { findUsersByUsernames } from './userStore';

// "A BOQ request is waiting for you" — the first-stage notification, in one
// place because it fires from two routes (creating a request with
// submit:true, and submitting a saved draft) and those two had drifted into
// copies of the same block.
//
// Addressed to the requester's OWN department manager; see
// findBomStageOneApprovers for why that replaced every Technical Manager.

export interface BomStageOneNotice {
  requestId: string;
  itemName: string;
  projectName: string;
  /** The request's department — whose manager gets this. */
  departmentId: string;
  /** Excluded from the send: a manager submitting their own request. */
  actorUsername: string;
}

export async function notifyBomStageOne(notice: BomStageOneNotice): Promise<void> {
  const { approvers, usedFallback, departmentName } = await findBomStageOneApprovers(notice.departmentId);
  if (usedFallback) {
    // Loud, because it means a BOQ request was routed to every Technical
    // Manager rather than to one department's own — the exact behaviour this
    // routing replaced. The cure is a manager on that department in
    // Department Master, not a code change.
    console.warn(
      `[tms][bom] ${departmentName || 'that department'} has no manager configured in Department Master — request ${notice.requestId} was routed to every Technical Manager instead.`
    );
  }

  const targets = approvers.filter((m) => m.username && m.username !== notice.actorUsername);
  if (!targets.length) return;

  const detail = usedFallback
    ? `Submitted by ${notice.actorUsername} — no manager is configured for ${departmentName || 'this department'}`
    : `Submitted by ${notice.actorUsername}`;

  await notifyUsers(
    targets.map((m) => m.username),
    {
      title: 'New BOQ request awaiting your approval',
      body: `${notice.actorUsername} submitted "${notice.itemName}" for ${notice.projectName}`,
      type: 'tms_bom_request_submitted',
      entityType: 'tms_bom_request',
      entityId: notice.requestId
    }
  );

  const users = await findUsersByUsernames(targets.map((m) => m.username));
  users.forEach((user) => {
    if (!user.email) return;
    void sendProcurementLifecycleEmail({
      name: user.name,
      email: user.email,
      urlPath: `/tms/bom-requests/${notice.requestId}`,
      event: 'bom_submitted',
      itemLabel: notice.itemName,
      projectName: notice.projectName,
      detail
    });
  });
}
