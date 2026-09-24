import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { reimbursementStore } from '@/lib/reimbursementStore';
import { reimbursementSheetStore, EDITABLE_SHEET_STATUSES } from '@/lib/reimbursementSheetStore';
import { checkAddPeriod } from '@/lib/reimbursementPeriod';
import { findUserByUsername } from '@/lib/userStore';
import { numberToIndianWords } from '@/lib/numberToWords';
import { ReimbursementRecord } from '@/lib/types';
import { apiErrorResponse } from '@/lib/apiError';

// A single bill may only be changed or removed while its sheet is still the
// employee's to change (draft, or sent back for correction). Without this the
// per-entry routes were a side door around every approval in the module: the
// owner — or ANY isPrivileged account, which here means admin, manager and
// technical, not just the one super admin — could edit the amount on a bill
// HR had already approved, or delete an hr_approved claim's bills one at a
// time, changing what Accounts is about to pay with no status check, no
// reason and no audit line. Deleting an approved claim is deliberately
// reserved for a super admin through DELETE /api/reimbursement/sheet/[id],
// which records what it destroyed; this keeps that the only way in.
async function sheetGuard(entry: ReimbursementRecord): Promise<string | null> {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(entry.date);
  if (!match) return null;
  const owner = await findUserByUsername(entry.created_by);
  if (!owner) return null;
  const sheet = await reimbursementSheetStore.findForPeriod(owner.id, Number(match[1]), Number(match[2]));
  // No sheet yet means nothing has been submitted for that month — the bill
  // is still loose and freely editable, exactly as before.
  if (!sheet || EDITABLE_SHEET_STATUSES.includes(sheet.status)) return null;
  return sheet.status === 'payment_done'
    ? 'This bill has already been paid and can’t be changed.'
    : 'This claim is already submitted for approval. Ask your manager or HR to send it back before changing a bill.';
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    const record = await reimbursementStore.findById(id);
    if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(record);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const existing = await reimbursementStore.findById(id);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const isHr = viewer.role === 'hr';
  const isOwnerOrPrivileged = existing.created_by === viewer.username || viewer.isPrivileged;
  if (!isOwnerOrPrivileged && !isHr) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  // HR can only edit the amount field
  if (isHr && !isOwnerOrPrivileged) {
    if (body.amount === undefined) return NextResponse.json({ error: 'No amount provided' }, { status: 400 });
    const amt = Number(body.amount);
    if (!amt || amt <= 0) return NextResponse.json({ error: 'Amount must be greater than zero' }, { status: 400 });
    try {
      const updated = await reimbursementStore.update(id, { amount: amt, amount_in_words: numberToIndianWords(amt) });
      return NextResponse.json(updated);
    } catch (error) {
      return apiErrorResponse(error);
    }
  }

  // Everything below this point is the OWNER's full edit of a bill, which is
  // only theirs to make while the claim is still in their hands. The HR
  // amount-only path above is exempt and returns before here: adjusting a
  // claimed amount during review is HR's job, and their review happens
  // precisely when the sheet is no longer editable by the employee.
  const blocked = await sheetGuard(existing);
  if (blocked) return NextResponse.json({ error: blocked }, { status: 409 });

  // Re-dating an entry is still "adding a bill for that month" — same
  // HR-mandated restriction as creating one (see lib/reimbursementPeriod.ts),
  // only checked when the date is actually moving somewhere new.
  if (body.date !== undefined && typeof body.date === 'string' && body.date !== existing.date) {
    let periodCheck = checkAddPeriod(body.date);
    if (!periodCheck.allowed) {
      const dateMatch = /^(\d{4})-(\d{2})-\d{2}$/.exec(body.date);
      if (dateMatch) {
        const user = await findUserByUsername(existing.created_by);
        const sheet = user ? await reimbursementSheetStore.findForPeriod(user.id, Number(dateMatch[1]), Number(dateMatch[2])) : null;
        periodCheck = checkAddPeriod(body.date, new Date(), sheet?.status);
      }
    }
    if (!periodCheck.allowed) return NextResponse.json({ error: periodCheck.reason }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (body.date !== undefined) patch.date = body.date;
  if (body.description !== undefined) patch.description = typeof body.description === 'string' ? body.description.trim() : '';
  if (body.employeeIds !== undefined) patch.employee_ids = Array.isArray(body.employeeIds) ? body.employeeIds.filter((v: unknown) => typeof v === 'string') : [];
  if (body.guestNames !== undefined) patch.guest_names = Array.isArray(body.guestNames) ? body.guestNames.filter((v: unknown): v is string => typeof v === 'string' && v.trim().length > 0).map((v: string) => v.trim()) : [];
  if (body.fromLocation !== undefined) patch.from_location = typeof body.fromLocation === 'string' ? body.fromLocation.trim() : '';
  if (body.toLocation !== undefined) patch.to_location = typeof body.toLocation === 'string' ? body.toLocation.trim() : '';
  if (body.kilometers !== undefined) patch.kilometers = Number(body.kilometers) || 0;
  if (body.amount !== undefined) {
    const amt = Number(body.amount);
    if (!amt || amt <= 0) return NextResponse.json({ error: 'Amount must be greater than zero' }, { status: 400 });
    patch.amount = amt;
    patch.amount_in_words = numberToIndianWords(amt);
  }
  if (body.modeOfPayment !== undefined) patch.mode_of_payment = typeof body.modeOfPayment === 'string' ? body.modeOfPayment.trim() : '';
  if (body.attachmentUrls !== undefined) {
    const urls = Array.isArray(body.attachmentUrls) ? body.attachmentUrls.filter((v: unknown) => typeof v === 'string') : [];
    const desc = typeof body.description === 'string' ? body.description.trim() : (patch.description as string || '');
    const isConveyance2w4w = /^Conveyance \((2 Wheeler|4 Wheeler)\)$/.test(desc);
    if (!isConveyance2w4w && !urls.length) return NextResponse.json({ error: 'At least one attachment is required' }, { status: 400 });
    patch.attachment_urls = urls;
  }

  try {
    const updated = await reimbursementStore.update(id, patch);
    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const existing = await reimbursementStore.findById(id);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (existing.created_by !== viewer.username && !viewer.isPrivileged) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const blocked = await sheetGuard(existing);
  if (blocked) return NextResponse.json({ error: blocked }, { status: 409 });

  try {
    await reimbursementStore.remove(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
