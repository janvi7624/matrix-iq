import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { viewerCanAccessOfficeOperationExpenses } from '@/lib/officeOperationExpenseAccess';
import {
  ITEM_FREE_TEXT_ITEMS,
  ITEM_FROM_DEPARTMENT_MASTER,
  USECASE_FREE_TEXT
} from '@/lib/officeOperationExpenseOptions';
import { getExpenseOptions } from '@/lib/officeExpenseOptionStore';
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
    // Resolved, not the raw constants: the lists are editable now, and the
    // form must render from exactly what the validator will accept.
    const [departments, options] = await Promise.all([listActiveDepartments(), getExpenseOptions()]);
    const itemSubOptions: Record<string, string[]> = { ...options.itemSubOptions };
    // 'Department' stays live Department Master data whatever the stored
    // catalogue says — it is the one sub-list nobody edits by hand.
    if (options.items.includes(ITEM_FROM_DEPARTMENT_MASTER)) {
      itemSubOptions[ITEM_FROM_DEPARTMENT_MASTER] = departments.map((d) => d.name);
    }

    return NextResponse.json({
      usecases: options.usecases,
      usecaseSubOptions: options.usecaseSubOptions,
      usecaseFreeText: USECASE_FREE_TEXT,
      items: options.items,
      itemSubOptions,
      itemFreeTextItems: ITEM_FREE_TEXT_ITEMS
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
