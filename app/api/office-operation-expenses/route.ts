import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { officeOperationExpenseStore } from '@/lib/officeOperationExpenseStore';
import { viewerCanAccessOfficeOperationExpenses } from '@/lib/officeOperationExpenseAccess';
import { numberToIndianWords } from '@/lib/numberToWords';
import { apiErrorResponse } from '@/lib/apiError';
import { parseExpenseBody } from '@/lib/officeOperationExpenseValidation';
import { findUsersByDepartmentName } from '@/lib/userStore';
import { notifyUsers } from '@/lib/notificationStore';
import { sendAdminExpenseNoticeEmail } from '@/lib/email/notifications';

// Office Operation Expenses had zero notification of any kind before this —
// same gap Admin Expenses had until earlier today. Mirrors
// notifyAccountsOfAdminExpense in app/api/admin-expenses/route.ts exactly,
// reusing the same email template (its "no manager/HR approval step"
// wording is equally true here).
async function notifyAccountsOfOfficeExpense(opts: {
  addedByName: string;
  usecase: string;
  amount: number;
  date: string;
  entryId: string;
}): Promise<void> {
  const accountsUsers = await findUsersByDepartmentName('Accounts');
  if (!accountsUsers.length) return;

  const totalStr = `₹${opts.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

  await notifyUsers(accountsUsers.map((u) => u.username), {
    title: 'Office operation expense created',
    body: `${opts.usecase} — ${totalStr} logged by ${opts.addedByName}`,
    type: 'office_expense_accounts_notice',
    entityType: 'office_operation_expense',
    entityId: opts.entryId
  });

  await Promise.allSettled(
    accountsUsers.map((u) =>
      sendAdminExpenseNoticeEmail({
        email: u.email, name: u.name || u.username, action: 'created',
        expenseType: opts.usecase, totalAmount: totalStr, employeeNames: [opts.addedByName],
        addedBy: opts.addedByName, date: opts.date
      })
    )
  );
}

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await viewerCanAccessOfficeOperationExpenses(viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const url = new URL(request.url);
  const now = new Date();

  // `year`/`month` remain the single-month form this route has always taken;
  // `fromYear`/`fromMonth`/`toYear`/`toMonth` add the custom range. Each end
  // of the range falls back to the single-month pair, which itself falls back
  // to the current month — so an old caller sending only year/month, or
  // nothing at all, behaves exactly as before.
  const year = clampYear(url.searchParams.get('year'), now.getFullYear());
  const month = clampMonth(url.searchParams.get('month'), now.getMonth() + 1);

  let from = {
    year: clampYear(url.searchParams.get('fromYear'), year),
    month: clampMonth(url.searchParams.get('fromMonth'), month)
  };
  let to = {
    year: clampYear(url.searchParams.get('toYear'), year),
    month: clampMonth(url.searchParams.get('toMonth'), month)
  };

  // Picked backwards in the UI — treat it as the range they meant rather than
  // returning an empty register that looks like "no expenses".
  if (from.year * 12 + from.month > to.year * 12 + to.month) [from, to] = [to, from];

  try {
    const records = await officeOperationExpenseStore.list(from, to);
    const total = records.reduce((sum, r) => sum + r.amount, 0);
    return NextResponse.json({
      records,
      total: Math.round(total * 100) / 100,
      totalInWords: numberToIndianWords(total),
      // The resolved range, echoed back so the client labels and exports what
      // the server actually queried rather than what it thinks it asked for.
      fromYear: from.year,
      fromMonth: from.month,
      toYear: to.year,
      toMonth: to.month,
      // Kept for any caller still reading the single-month shape; on a range
      // these are its first month.
      year: from.year,
      month: from.month
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/** A sane 1-12 month, or the fallback. Rejects NaN, 0, 13 and negatives. */
function clampMonth(raw: string | null, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : fallback;
}

/** A sane 4-digit year, or the fallback. */
function clampYear(raw: string | null, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : fallback;
}

export async function POST(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await viewerCanAccessOfficeOperationExpenses(viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  try {
    const parsed = await parseExpenseBody(body);
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const record = await officeOperationExpenseStore.create(viewer.username, parsed.data);

    await notifyAccountsOfOfficeExpense({
      addedByName: record.creator_name, usecase: record.usecase, amount: record.amount,
      date: record.date, entryId: record.id
    });

    return NextResponse.json(record, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
