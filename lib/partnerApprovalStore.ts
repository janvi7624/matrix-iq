import { db, isUuid } from './db';
import { listDepartmentManagers } from './departmentStore';
import { findUserById } from './userStore';
import { onboardingProgress } from './partnerOnboarding';
import {
  PARTNER_APPROVAL_DEPARTMENT,
  PARTNER_APPROVAL_STAGES,
  PartnerApprovalStage,
  PartnerApprovalTrailEntry,
  nextApprovalStage
} from './partnerApprovalChain';

// The server side of lib/partnerApprovalChain.ts: who may sign off each
// step, starting the chain once every document is in, and recording a
// decision.

export class PartnerApprovalError extends Error {}

export interface StageApprover {
  id: string;
  username: string;
  name: string;
}

/** Department Master's managers of the department that owns this step. */
export async function stageApprovers(stage: PartnerApprovalStage): Promise<StageApprover[]> {
  const managers = await listDepartmentManagers();
  return managers[PARTNER_APPROVAL_DEPARTMENT[stage]] ?? [];
}

/** Every step's approvers at once — what the detail screen shows on the stepper. */
export async function allStageApprovers(): Promise<Record<PartnerApprovalStage, StageApprover[]>> {
  const managers = await listDepartmentManagers();
  const out = {} as Record<PartnerApprovalStage, StageApprover[]>;
  for (const stage of PARTNER_APPROVAL_STAGES) out[stage] = managers[PARTNER_APPROVAL_DEPARTMENT[stage]] ?? [];
  return out;
}

/** The steps this user signs off, by Department Master membership. */
export async function approverStagesFor(userId: string): Promise<PartnerApprovalStage[]> {
  if (!userId) return [];
  const all = await allStageApprovers();
  return PARTNER_APPROVAL_STAGES.filter((stage) => all[stage].some((m) => m.id === userId));
}

/** Is this user an approver at any step? Grants read access to partners and their documents. */
export async function isPartnerChainApprover(userId: string): Promise<boolean> {
  return (await approverStagesFor(userId)).length > 0;
}

/**
 * Begins (or restarts) the chain at Sales once every document is uploaded
 * and none is outstanding as rejected. Called after any upload. A partner
 * already through the chain is left alone — replacing a document later does
 * not revoke access (see partnerOnboardingComplete). Returns the stage now
 * pending, or null if nothing changed.
 */
export async function startApprovalIfReady(partnerId: string): Promise<PartnerApprovalStage | null> {
  if (!isUuid(partnerId)) return null;
  const partner = await db.Partner.findByPk(partnerId);
  if (!partner) return null;
  if (partner.get('onboarded_at') || partner.get('approval_stage') === 'approved') return null;

  const docs = await db.PartnerDocument.findAll({ where: { partner_id: partnerId } as never, attributes: ['kind', 'status'] });
  const progress = onboardingProgress(docs.map((d) => ({ kind: d.get('kind') as string, status: d.get('status') as string })));
  if (progress.missing.length || progress.rejected.length) return null;

  // A document replaced mid-chain restarts the round: whoever approved the
  // old file has not seen the new one.
  await partner.update({ approval_stage: 'sales' } as never);
  return 'sales';
}

export interface DecideResult {
  stage: PartnerApprovalStage;
  next: PartnerApprovalStage | 'approved' | null;
  onboardingCompleted: boolean;
}

/**
 * One approver's decision on the current step.
 *
 * Approve moves to the next step; approving the last step marks every
 * document approved and stamps onboarded_at in the same transaction. Reject
 * requires a remark, marks the chosen documents (all, if none chosen)
 * rejected so the partner knows what to replace, and sends the set back to
 * them — the next round starts again from Sales.
 */
export async function decideApprovalStage(input: {
  partnerId: string;
  stage: PartnerApprovalStage;
  decision: 'approved' | 'rejected';
  reviewerId: string;
  remarks: string;
  rejectKinds?: string[];
}): Promise<DecideResult> {
  const remarks = (input.remarks || '').trim();
  if (input.decision === 'rejected' && !remarks) throw new PartnerApprovalError('Say what needs correcting — the partner sees this.');
  if (remarks.length > 2000) throw new PartnerApprovalError('Keep the note under 2000 characters.');

  const approvers = await stageApprovers(input.stage);
  if (!approvers.some((a) => a.id === input.reviewerId)) {
    throw new PartnerApprovalError('Only the department manager responsible for this step can decide it.');
  }

  const reviewer = await findUserById(input.reviewerId);
  const entry: PartnerApprovalTrailEntry = {
    stage: input.stage,
    decision: input.decision,
    by_id: input.reviewerId,
    by_name: reviewer?.name || reviewer?.username || '',
    at: new Date().toISOString(),
    remarks
  };

  let next: DecideResult['next'] = null;
  let onboardingCompleted = false;

  await db.sequelize.transaction(async (t) => {
    const partner = await db.Partner.findByPk(input.partnerId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!partner) throw new PartnerApprovalError('Partner not found.');
    if (partner.get('approval_stage') !== input.stage) {
      throw new PartnerApprovalError('This step is not awaiting a decision — refresh and try again.');
    }
    const trail = Array.isArray(partner.get('approval_trail')) ? (partner.get('approval_trail') as PartnerApprovalTrailEntry[]) : [];

    if (input.decision === 'rejected') {
      const kinds = (input.rejectKinds || []).filter(Boolean);
      const where = kinds.length ? { partner_id: input.partnerId, kind: kinds } : { partner_id: input.partnerId };
      await db.PartnerDocument.update(
        { status: 'rejected', reviewed_by: input.reviewerId, reviewed_at: new Date(), review_remarks: remarks } as never,
        { where: where as never, transaction: t }
      );
      await partner.update({ approval_stage: null, approval_trail: [...trail, entry] } as never, { transaction: t });
      next = null;
      return;
    }

    const after = nextApprovalStage(input.stage);
    next = after;
    if (after === 'approved') {
      await db.PartnerDocument.update(
        { status: 'approved', reviewed_by: input.reviewerId, reviewed_at: new Date() } as never,
        { where: { partner_id: input.partnerId } as never, transaction: t }
      );
      const patch: Record<string, unknown> = { approval_stage: 'approved', approval_trail: [...trail, entry] };
      if (!partner.get('onboarded_at')) {
        patch.onboarded_at = new Date();
        onboardingCompleted = true;
      }
      await partner.update(patch as never, { transaction: t });
    } else {
      await partner.update({ approval_stage: after, approval_trail: [...trail, entry] } as never, { transaction: t });
    }
  });

  return { stage: input.stage, next, onboardingCompleted };
}
