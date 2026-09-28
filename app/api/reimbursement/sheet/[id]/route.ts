import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { reimbursementSheetStore } from '@/lib/reimbursementSheetStore';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';

// DELETE — permanently remove an approved-but-unpaid reimbursement claim.
//
// This is the one destructive action in the reimbursement module: it erases
// the sheet AND the employee's bill entries for that month from the database
// outright (both tables are paranoid:false, so there is no soft-deleted copy
// and no undo). It exists so a claim that was approved by mistake, or a
// duplicate, can be stopped before Accounts pays it.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Super admin ONLY — deliberately the role key, not viewer.isPrivileged.
  // 'admin' and 'manager' are both privileged in this deployment (and a
  // department manager can be made privileged from Role Management), so
  // isPrivileged would hand an irreversible delete of someone else's approved
  // expenses to roughly a dozen people. There is exactly one superadmin.
  if (viewer.role !== 'superadmin') {
    return NextResponse.json({ error: 'Forbidden — only a super admin can delete a reimbursement claim' }, { status: 403 });
  }

  const { id } = await params;
  try {
    const sheet = await reimbursementSheetStore.findById(id);
    if (!sheet) return NextResponse.json({ error: 'Sheet not found' }, { status: 404 });

    // Only a claim that is approved and waiting for Accounts. Not a draft
    // somebody is still filling in, not one mid-approval, and above all not
    // one already marked paid — deleting that would erase the record of money
    // that actually left the company, which Accounts still has to reconcile
    // against the bank.
    if (sheet.status !== 'hr_approved') {
      return NextResponse.json({
        error: sheet.status === 'payment_done'
          ? 'This claim has already been paid, so it can’t be deleted — the payment still has to reconcile.'
          : 'Only a claim that is approved and awaiting payment can be deleted.'
      }, { status: 409 });
    }

    // The client echoes back the sheet code it believes it is deleting. If it
    // doesn't match, the list was stale and this is not the row the person
    // was looking at — refuse rather than delete somebody else's claim.
    const body = await request.json().catch(() => null);
    const confirmCode = body && typeof body.confirmSheetCode === 'string' ? body.confirmSheetCode.trim() : '';
    if (!confirmCode || confirmCode !== sheet.sheet_code) {
      return NextResponse.json({ error: 'Confirmation did not match this claim. Refresh and try again.' }, { status: 400 });
    }

    const reason = body && typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!reason) {
      return NextResponse.json({ error: 'Give a reason — it is the only record that will survive this deletion.' }, { status: 400 });
    }

    const deleted = await reimbursementSheetStore.deleteSheetWithEntries(id);
    if (!deleted) return NextResponse.json({ error: 'Sheet not found' }, { status: 404 });

    // Written after the rows are gone, so a deletion is never logged that
    // didn't happen. logAudit never throws, and entity_id points at a row
    // that no longer exists — which is the point: this line is the only
    // remaining evidence of what was removed.
    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'reimbursement_sheet',
      entityId: id,
      action: `Deleted reimbursement claim ${deleted.sheetCode}`,
      previousStatus: deleted.status,
      newStatus: 'deleted',
      remarks: [
        `${deleted.employeeName}${deleted.employeeId ? ` (${deleted.employeeId})` : ''}`,
        `${deleted.monthName} ${deleted.year}`,
        `${deleted.entriesDeleted} entr${deleted.entriesDeleted === 1 ? 'y' : 'ies'}`,
        `₹${deleted.totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
        deleted.managerName ? `manager: ${deleted.managerName}` : '',
        deleted.hrReviewerName ? `HR: ${deleted.hrReviewerName}` : '',
        `reason: ${reason}`
      ].filter(Boolean).join(' · '),
      ip: getClientIp(request)
    });

    return NextResponse.json({ deleted: true, ...deleted });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
