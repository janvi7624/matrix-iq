import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { viewerCanAccessOfficeOperationExpenses } from '@/lib/officeOperationExpenseAccess';
import { BASE_EXPENSE_OPTIONS, ExpenseOptionError, ResolvedExpenseOptions } from '@/lib/officeExpenseOptionResolve';
import { getExpenseOptions, saveExpenseOptions } from '@/lib/officeExpenseOptionStore';
import { ITEM_FROM_DEPARTMENT_MASTER } from '@/lib/officeOperationExpenseOptions';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';

// Editing the Office Operation Expense picklists.
//
// Gated by exactly the same rule as the register itself
// (viewerCanAccessOfficeOperationExpenses — Super Admin, Admin, and the
// named grants in lib/hrExpenseAccess.ts). The people recording the spend
// are the ones who notice a missing category first, and the module is
// already held by a handful of accounts.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await viewerCanAccessOfficeOperationExpenses(viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    return NextResponse.json({
      options: await getExpenseOptions(),
      // So the editor can show what "reset to default" would restore.
      defaults: BASE_EXPENSE_OPTIONS,
      // Flagged rather than hidden: its sub-list is live Department Master
      // data, so editing it here would have no effect.
      departmentDrivenItem: ITEM_FROM_DEPARTMENT_MASTER
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await viewerCanAccessOfficeOperationExpenses(viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body?.options) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  try {
    const options = await saveExpenseOptions(body.options as ResolvedExpenseOptions, viewer.userId);

    void logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'office_operation_expense',
      entityId: 'options',
      action: 'Office expense categories updated',
      previousStatus: '',
      newStatus: '',
      remarks: `${options.usecases.length} categories, ${options.items.length} expense heads`,
      ip: getClientIp(request)
    });

    return NextResponse.json({ ok: true, options });
  } catch (error) {
    if (error instanceof ExpenseOptionError) return NextResponse.json({ error: error.message }, { status: 400 });
    return apiErrorResponse(error);
  }
}
