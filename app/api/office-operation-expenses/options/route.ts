import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { viewerCanAccessOfficeOperationExpenses } from '@/lib/officeOperationExpenseAccess';
import {
  ITEM_FROM_DEPARTMENT_MASTER,
  ITEM_SUB_OPTIONS,
  OFFICE_EXPENSE_ITEMS,
  OFFICE_EXPENSE_USECASES,
  USECASE_FREE_TEXT,
  USECASE_SUB_OPTIONS
} from '@/lib/officeOperationExpenseOptions';
import { listActiveDepartments } from '@/lib/departmentStore';
import { apiErrorResponse } from '@/lib/apiError';

// One request for every picklist the form needs, so the client renders from
// exactly what the server will validate against — including the 'Department'
// item's sub-list, which is live Department Master data and therefore can't be
// a client-side constant.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await viewerCanAccessOfficeOperationExpenses(viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const departments = await listActiveDepartments();
    const itemSubOptions: Record<string, string[]> = { ...ITEM_SUB_OPTIONS };
    itemSubOptions[ITEM_FROM_DEPARTMENT_MASTER] = departments.map((d) => d.name);

    return NextResponse.json({
      usecases: OFFICE_EXPENSE_USECASES,
      usecaseSubOptions: USECASE_SUB_OPTIONS,
      usecaseFreeText: USECASE_FREE_TEXT,
      items: OFFICE_EXPENSE_ITEMS,
      itemSubOptions
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
