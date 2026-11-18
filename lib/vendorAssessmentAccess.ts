import { notifyUsers } from './notificationStore';
import { vendorStageApprovers } from './vendorAssessmentStore';
import { VENDOR_APPROVAL_STAGES, VENDOR_STAGE_LABEL, VendorApprovalStage, VendorAssessmentRecord } from './vendorAssessmentShared';

// Who sees what in Vendor Assessment:
//   admins / privileged roles and every approver (Sales, Accounts, Management
//   managers) see every assessment; anyone else sees the ones they created or
//   were named as initiator on. Anyone may create one.

export interface VendorViewer {
  userId: string;
  username: string;
  name: string;
  isPrivileged: boolean;
}

export async function vendorViewerScope(viewer: VendorViewer) {
  const approvers = await vendorStageApprovers();
  const myStages = VENDOR_APPROVAL_STAGES.filter((s) => approvers[s].some((a) => a.id === viewer.userId));
  const seesAll = viewer.isPrivileged || myStages.length > 0;
  return { approvers, myStages, seesAll };
}

export function canSeeVendorRecord(viewer: VendorViewer, seesAll: boolean, r: VendorAssessmentRecord): boolean {
  return seesAll || r.created_by === viewer.userId || r.initiated_by_ids.includes(viewer.userId);
}

export function canEditVendorRecord(viewer: VendorViewer, r: VendorAssessmentRecord): boolean {
  return viewer.isPrivileged || (r.created_by === viewer.userId && r.status !== 'approved');
}

export async function notifyVendorStage(stage: VendorApprovalStage, record: { id: string; company_name: string }) {
  const approvers = (await vendorStageApprovers())[stage];
  if (!approvers.length) return;
  await notifyUsers(
    approvers.map((a) => a.username),
    {
      title: 'Vendor assessment — your approval is pending',
      body: `${record.company_name} is waiting for your sign-off as ${VENDOR_STAGE_LABEL[stage]}.`,
      type: 'vendor_assessment_pending',
      entityType: 'vendor_assessment',
      entityId: record.id
    }
  );
}
