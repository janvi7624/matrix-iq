import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { numberToIndianWords } from '@/lib/numberToWords';
import { apiErrorResponse } from '@/lib/apiError';
import { assertAdmin, APPROVER_USERNAME, notifyAccountsOfAdminExpense, notifyApproverOfPendingExpense } from '@/lib/adminExpenseAccess';

interface ResolvedExpenseFields {
  description: string;
  from: string;
  to: string;
  resolvedDate: string;
  // Hotel's check-out, or a return flight's return date — every other
  // type/leg leaves this null. Same column, dual meaning depending on
  // `description`, same as the client's AdminEntry.check_out_date.
  checkOut: string | null;
}

// Shared by POST and PUT — was duplicated verbatim between them before,
// which is exactly the kind of thing that drifts when one gets a fix/new
// type and the other doesn't.
function resolveExpenseFields(body: Record<string, unknown>): ResolvedExpenseFields | { error: string } {
  const { type, date, checkInDate, checkOutDate, location, fromLocation, toLocation, otherType } = body;

  if (type === 'Hotel') {
    const from = typeof location === 'string' ? location.trim() : '';
    if (!from) return { error: 'Location is required for Hotel' };
    if (!checkInDate || !checkOutDate) return { error: 'Check-in and check-out dates are required for Hotel' };
    if (checkOutDate <= checkInDate) return { error: 'Check-out date must be after check-in date' };
    return { description: 'Hotel', from, to: '', resolvedDate: checkInDate as string, checkOut: checkOutDate as string };
  }

  if (type === 'Bus Ticket' || type === 'Train Ticket' || type === 'Flight Ticket') {
    const from = typeof fromLocation === 'string' ? fromLocation.trim() : '';
    const to = typeof toLocation === 'string' ? toLocation.trim() : '';
    if (!from || !to) return { error: 'From and To are required for ticket booking' };
    if (!date) return { error: 'Travel date is required' };
    // Return-trip flights only — Bus/Train stay one-way, no return leg was
    // asked for on those. Same-day return IS allowed (unlike Hotel's
    // checkout-must-be-after-checkin rule) since a same-day round trip is
    // the whole point of this field.
    let checkOut: string | null = null;
    if (type === 'Flight Ticket' && checkOutDate) {
      if (checkOutDate < date) return { error: 'Return date cannot be before the departure date' };
      checkOut = checkOutDate as string;
    }
    return { description: type as string, from, to, resolvedDate: date as string, checkOut };
  }

  if (type === 'Visa Expense') {
    const from = typeof location === 'string' ? location.trim() : '';
    if (!date) return { error: 'Date is required' };
    return { description: 'Visa Expense', from, to: '', resolvedDate: date as string, checkOut: null };
  }

  if (type === 'Other Expense') {
    // A free-typed expense type not covered by the fixed list — the typed
    // name itself becomes `description` (same column the fixed types store
    // their own literal name in), and location is optional here (an "other"
    // expense might not have one, e.g. a courier fee).
    const description = typeof otherType === 'string' ? otherType.trim() : '';
    if (!description) return { error: 'Please specify the expense type' };
    const from = typeof location === 'string' ? location.trim() : '';
    if (!date) return { error: 'Date is required' };
    return { description, from, to: '', resolvedDate: date as string, checkOut: null };
  }

  return { error: 'Invalid type' };
}

export async function GET(request: NextRequest) {
  const admin = await assertAdmin(request);
  if (!admin) return NextResponse.json({ error: 'Access denied' }, { status: 403 });

  try {
    const rows = await db.Reimbursement.findAll({
      where: { is_admin_entry: true } as never,
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
      const empId = rec.created_by as string;
      if (creator && !g.employees.find((e: any) => e.id === empId)) {
        g.employees.push({ id: empId, name: (creator.name as string) || (creator.username as string) || empId });
      }
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

  if (!type || !Array.isArray(employeeIds) || !employeeIds.length || !totalAmount) {
    return NextResponse.json({ error: 'Type, date, employees, and total amount are required' }, { status: 400 });
  }

  const amt = Number(totalAmount);
  if (!amt || amt <= 0) return NextResponse.json({ error: 'Amount must be greater than zero' }, { status: 400 });

  const resolved = resolveExpenseFields(body);
  if ('error' in resolved) return NextResponse.json({ error: resolved.error }, { status: 400 });
  const { description, from, to, resolvedDate, checkOut } = resolved;

  const splitCount = employeeIds.length;
  const perPerson = Math.round((amt / splitCount) * 100) / 100;
  const batchId = `admin-${Date.now()}`;
  const urls: string[] = Array.isArray(attachmentUrls) ? attachmentUrls.filter((v: unknown) => typeof v === 'string') : [];
  const isApprover = admin.username === APPROVER_USERNAME;

  try {
    const created = [];
    for (const empId of employeeIds) {
      // Find which user this is to get their ID for created_by
      const row = await db.Reimbursement.create({
        created_by: empId,
        date: resolvedDate,
        check_out_date: checkOut,
        description,
        employee_ids: [empId],
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
  if (!batchId) return NextResponse.json({ error: 'batchId is required' }, { status: 400 });

  if (!type || !Array.isArray(employeeIds) || !employeeIds.length || !totalAmount) {
    return NextResponse.json({ error: 'Type, date, employees, and total amount are required' }, { status: 400 });
  }

  const amt = Number(totalAmount);
  if (!amt || amt <= 0) return NextResponse.json({ error: 'Amount must be greater than zero' }, { status: 400 });

  const resolved = resolveExpenseFields(body);
  if ('error' in resolved) return NextResponse.json({ error: resolved.error }, { status: 400 });
  const { description, from, to, resolvedDate, checkOut } = resolved;

  const splitCount = employeeIds.length;
  const perPerson = Math.round((amt / splitCount) * 100) / 100;
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
    for (const empId of employeeIds) {
      await db.Reimbursement.create({
        created_by: empId,
        date: resolvedDate,
        check_out_date: checkOut,
        description,
        employee_ids: [empId],
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
