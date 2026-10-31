import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { numberToIndianWords } from '@/lib/numberToWords';
import { apiErrorResponse } from '@/lib/apiError';
import { assertAdmin, APPROVER_USERNAME, notifyAccountsOfAdminExpense, notifyApproverOfPendingExpense } from '@/lib/adminExpenseAccess';
import { UNALLOCATED_LABEL, isUnallocatedSelection } from '@/lib/adminExpenseUnallocated';
import { resolveExpenseFields } from '@/lib/adminExpenseFields';


export async function GET(request: NextRequest) {
  const admin = await assertAdmin(request);
  if (!admin) return NextResponse.json({ error: 'Access denied' }, { status: 403 });

  // ?batchId= returns the one batch, for the Edit Expense page (no longer a
  // modal over the already-loaded list) — same batchId convention DELETE
  // already uses.
  const batchId = request.nextUrl.searchParams.get('batchId');

  try {
    const rows = await db.Reimbursement.findAll({
      where: (batchId ? { admin_note: batchId, is_admin_entry: true } : { is_admin_entry: true }) as never,
      include: [
        { model: db.User, as: 'creator', attributes: ['id', 'username', 'name'] },
        { model: db.User, as: 'approver', attributes: ['id', 'username', 'name'] },
      ] as never,
      order: [['created_at', 'DESC']],
    });

    const records = rows.map((row: any) => row.get({ plain: true }));

    const grouped = new Map<string, any>();
    for (const rec of records) {
      const key = rec.admin_note || rec.id;
      if (!grouped.has(key)) {
        grouped.set(key, {
          batchId: key,
          date: rec.date,
          check_out_date: rec.check_out_date || '',
          description: rec.description,
          from_location: rec.from_location || '',
          to_location: rec.to_location || '',
          total_amount: Number(rec.admin_total_amount) || 0,
          split_count: Number(rec.admin_split_count) || 0,
          per_person: Number(rec.amount) || 0,
          employees: [] as { id: string; name: string }[],
          created_at: rec.created_at,
          approval_status: rec.approval_status || 'approved',
          approved_by_name: rec.approver ? ((rec.approver.name as string) || (rec.approver.username as string)) : '',
          approved_at: rec.approved_at || '',
        });
      }
      const g = grouped.get(key)!;
      const creator = rec.creator as Record<string, unknown> | undefined;
      const empId = rec.created_by as string | null;
      if (!empId) {
        // No owner by design — named here so the list never shows a blank
        // where a payee should be.
        if (!g.employees.find((e: { id: string }) => e.id === 'unallocated')) {
          g.employees.push({ id: 'unallocated', name: UNALLOCATED_LABEL });
        }
      } else if (creator && !g.employees.find((e: { id: string }) => e.id === empId)) {
        g.employees.push({ id: empId, name: (creator.name as string) || (creator.username as string) || empId });
      }
    }

    if (batchId) {
      const entry = grouped.get(batchId);
      if (!entry) return NextResponse.json({ error: 'Batch not found' }, { status: 404 });
      return NextResponse.json({ entry });
    }

    return NextResponse.json({ entries: [...grouped.values()] });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const admin = await assertAdmin(request);
  if (!admin) return NextResponse.json({ error: 'Access denied' }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const { type, employeeIds, totalAmount, attachmentUrls } = body;

  // 'Other / Unallocated' is a selection, not an absence — the cost is
  // recorded on its own row with no employee rather than pinned to whoever
  // happened to be picked. Exclusive by design: it is never split.
  const unallocated = isUnallocatedSelection(employeeIds);

  if (!type || !Array.isArray(employeeIds) || !employeeIds.length || !totalAmount) {
    return NextResponse.json({ error: 'Type, date, employees, and total amount are required' }, { status: 400 });
  }

  const amt = Number(totalAmount);
  if (!amt || amt <= 0) return NextResponse.json({ error: 'Amount must be greater than zero' }, { status: 400 });

  const resolved = resolveExpenseFields(body);
  if ('error' in resolved) return NextResponse.json({ error: resolved.error }, { status: 400 });
  const { description, from, to, resolvedDate, checkOut } = resolved;

  const splitCount = unallocated ? 1 : employeeIds.length;
  const perPerson = unallocated ? amt : Math.round((amt / splitCount) * 100) / 100;
  const batchId = `admin-${Date.now()}`;
  const urls: string[] = Array.isArray(attachmentUrls) ? attachmentUrls.filter((v: unknown) => typeof v === 'string') : [];
  const isApprover = admin.username === APPROVER_USERNAME;

  try {
    const created = [];
    // One row with no owner, or one row per employee.
    for (const empId of unallocated ? [null] : employeeIds) {
      const row = await db.Reimbursement.create({
        created_by: empId,
        date: resolvedDate,
        check_out_date: checkOut,
        description,
        employee_ids: empId ? [empId] : [],
        from_location: from,
        to_location: to,
        kilometers: null,
        amount: perPerson,
        mode_of_payment: 'Company Paid',
        amount_in_words: numberToIndianWords(perPerson),
        attachment_urls: urls,
        is_admin_entry: true,
        admin_note: batchId,
        admin_total_amount: amt,
        admin_split_count: splitCount,
        payment_status: 'payment_required',
        approval_status: isApprover ? 'approved' : 'pending_approval',
        approved_by: isApprover ? admin.userId : null,
        approved_at: isApprover ? new Date() : null,
      } as never);
      created.push(row.get({ plain: true }));
    }

    if (isApprover) {
      await notifyAccountsOfAdminExpense({
        action: 'created', addedByName: admin.name, expenseType: description,
        totalAmount: amt, resolvedDate, batchId, employeeIds,
      });
    } else {
      await notifyApproverOfPendingExpense({
        addedByName: admin.name, expenseType: description, totalAmount: amt, batchId,
      });
    }

    return NextResponse.json({
      message: `Created ${created.length} entries (₹${perPerson} per person from total ₹${amt})`,
      batchId,
      perPerson,
      count: created.length,
    }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PUT(request: NextRequest) {
  const admin = await assertAdmin(request);
  if (!admin) return NextResponse.json({ error: 'Access denied' }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const { batchId, type, employeeIds, totalAmount } = body;
  const unallocatedEdit = isUnallocatedSelection(employeeIds);
  if (!batchId) return NextResponse.json({ error: 'batchId is required' }, { status: 400 });

  if (!type || !Array.isArray(employeeIds) || !employeeIds.length || !totalAmount) {
    return NextResponse.json({ error: 'Type, date, employees, and total amount are required' }, { status: 400 });
  }

  const amt = Number(totalAmount);
  if (!amt || amt <= 0) return NextResponse.json({ error: 'Amount must be greater than zero' }, { status: 400 });

  const resolved = resolveExpenseFields(body);
  if ('error' in resolved) return NextResponse.json({ error: resolved.error }, { status: 400 });
  const { description, from, to, resolvedDate, checkOut } = resolved;

  const splitCount = unallocatedEdit ? 1 : employeeIds.length;
  const perPerson = unallocatedEdit ? amt : Math.round((amt / splitCount) * 100) / 100;
  const isApprover = admin.username === APPROVER_USERNAME;

  try {
    // Accounts Payment Queue — a batch Accounts has already paid is
    // protected from being silently rewritten by an HR/Admin edit (Part 32:
    // once Paid, payment information isn't casually editable). The batch
    // must be put back to payment_required via the payments workspace first
    // if it genuinely needs correction.
    const existingRows = await db.Reimbursement.findAll({ where: { admin_note: batchId, is_admin_entry: true } as never, attributes: ['payment_status'] });
    if (!existingRows.length) return NextResponse.json({ error: 'Batch not found' }, { status: 404 });
    if (existingRows.some((r) => (r.get({ plain: true }) as Record<string, unknown>).payment_status === 'paid')) {
      return NextResponse.json({ error: 'This batch has already been paid and can no longer be edited' }, { status: 400 });
    }

    // Delete old batch entries
    await db.Reimbursement.destroy({ where: { admin_note: batchId, is_admin_entry: true } as never });

    // Create new entries
    for (const empId of unallocatedEdit ? [null] : employeeIds) {
      await db.Reimbursement.create({
        created_by: empId,
        date: resolvedDate,
        check_out_date: checkOut,
        description,
        employee_ids: empId ? [empId] : [],
        from_location: from,
        to_location: to,
        kilometers: null,
        amount: perPerson,
        mode_of_payment: 'Company Paid',
        amount_in_words: numberToIndianWords(perPerson),
        attachment_urls: [],
        is_admin_entry: true,
        admin_note: batchId,
        admin_total_amount: amt,
        admin_split_count: splitCount,
        payment_status: 'payment_required',
        // Re-editing resets approval — Hardik approved the ORIGINAL details,
        // not whatever this edit just changed them to, unless he's the one
        // making the edit.
        approval_status: isApprover ? 'approved' : 'pending_approval',
        approved_by: isApprover ? admin.userId : null,
        approved_at: isApprover ? new Date() : null,
      } as never);
    }

    if (isApprover) {
      await notifyAccountsOfAdminExpense({
        action: 'updated', addedByName: admin.name, expenseType: description,
        totalAmount: amt, resolvedDate, batchId, employeeIds,
      });
    } else {
      await notifyApproverOfPendingExpense({
        addedByName: admin.name, expenseType: description, totalAmount: amt, batchId,
      });
    }

    return NextResponse.json({
      message: `Updated batch (₹${perPerson} per person from total ₹${amt})`,
      batchId,
      perPerson,
      count: splitCount,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  const admin = await assertAdmin(request);
  if (!admin) return NextResponse.json({ error: 'Access denied' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const batchId = searchParams.get('batchId');
  if (!batchId) return NextResponse.json({ error: 'batchId is required' }, { status: 400 });

  try {
    const existingRows = await db.Reimbursement.findAll({ where: { admin_note: batchId, is_admin_entry: true } as never, attributes: ['payment_status'] });
    if (existingRows.some((r) => (r.get({ plain: true }) as Record<string, unknown>).payment_status === 'paid')) {
      return NextResponse.json({ error: 'This batch has already been paid and can no longer be deleted' }, { status: 400 });
    }

    const count = await db.Reimbursement.destroy({ where: { admin_note: batchId, is_admin_entry: true } as never });
    return NextResponse.json({ message: `Deleted ${count} entries`, count });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
