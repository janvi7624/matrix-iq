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
  const year = Number(url.searchParams.get('year')) || now.getFullYear();
  const month = Number(url.searchParams.get('month')) || now.getMonth() + 1;

  try {
    const records = await officeOperationExpenseStore.list(year, month);
    const total = records.reduce((sum, r) => sum + r.amount, 0);
    return NextResponse.json({
      records,
      total: Math.round(total * 100) / 100,
      totalInWords: numberToIndianWords(total),
      year,
      month
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
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
