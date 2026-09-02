import { OfficeOperationExpenseInput } from './officeOperationExpenseStore';
import {
  ITEM_FROM_DEPARTMENT_MASTER,
  ITEM_SUB_OPTIONS,
  USECASE_FREE_TEXT,
  USECASE_SUB_OPTIONS,
  isValidItem,
  isValidUsecase
} from './officeOperationExpenseOptions';
import { listActiveDepartments } from './departmentStore';

export type ParseResult = { data: OfficeOperationExpenseInput } | { error: string };

// Shared by POST (create) and PUT (edit) so the two can't drift on what counts
// as a valid entry — the edit path stays exactly as strict as the create path.
// Returns a discriminated result rather than throwing, so the routes keep
// answering with a 400 and a real message instead of a 500 via apiErrorResponse.
//
// Both picklist fields are validated against the same option lists the form
// renders from (lib/officeOperationExpenseOptions.ts), so a hand-rolled
// request can't put a value into the register that the UI would never offer.
export async function parseExpenseBody(body: Record<string, unknown>): Promise<ParseResult> {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

  const date = str(body.date);
  const usecase = str(body.usecase);
  const usecaseDetail = str(body.usecaseDetail);
  const itemName = str(body.itemName);
  // Several sub-items may be picked on one entry. Duplicates are collapsed and
  // blanks dropped so the stored array is exactly what was chosen.
  const itemSubNames = Array.isArray(body.itemSubNames)
    ? [...new Set(body.itemSubNames.map((v: unknown) => str(v)).filter(Boolean))]
    : [];
  // Both free-text and optional — no length/content rules beyond trimming.
  const description = str(body.description);
  const remarks = str(body.remarks);
  const amount = Number(body.amount);

  // Item Qty is optional. Absent / null / '' all mean "not specified" and
  // store NULL. A value that IS supplied still has to be a sane positive
  // number — accepting -3 or 'abc' would just move the bad data downstream.
  // Checked before the required-field guards below so a garbage qty reports
  // its own error rather than being masked by an unrelated one.
  const rawQty = body.itemQty;
  const qtyOmitted = rawQty === undefined || rawQty === null || String(rawQty).trim() === '';
  let itemQty: number | null = null;
  if (!qtyOmitted) {
    const parsedQty = Number(rawQty);
    if (!Number.isFinite(parsedQty) || parsedQty <= 0) return { error: 'Item Qty must be greater than zero when provided' };
    itemQty = parsedQty;
  }

  if (!date) return { error: 'Date is required' };
  if (!usecase) return { error: 'Category is required' };
  if (!isValidUsecase(usecase)) return { error: `"${usecase}" is not a valid category` };
  if (!itemName) return { error: 'Expense Head is required' };
  if (!isValidItem(itemName)) return { error: `"${itemName}" is not a valid item` };
  if (!Number.isFinite(amount) || amount <= 0) return { error: 'Amount must be greater than zero' };

  // A usecase with a fixed sub-list must carry one of its values; 'Other' must
  // carry the free-typed label (that's the only thing telling one 'Other' row
  // from another); a usecase with neither stores nothing.
  const usecaseSubs = USECASE_SUB_OPTIONS[usecase];
  const usecaseHasDetail = !!usecaseSubs || usecase === USECASE_FREE_TEXT;
  if (usecaseSubs) {
    if (!usecaseDetail) return { error: `Select which ${usecase.toLowerCase()} this is` };
    if (!usecaseSubs.includes(usecaseDetail)) return { error: `"${usecaseDetail}" is not a valid ${usecase} option` };
  } else if (usecase === USECASE_FREE_TEXT && !usecaseDetail) {
    return { error: 'Describe the category' };
  }

  const subNameError = await validateItemSubNames(itemName, itemSubNames);
  if (subNameError) return { error: subNameError };

  return {
    data: {
      date,
      usecase,
      usecase_detail: usecaseHasDetail ? usecaseDetail : '',
      item_name: itemName,
      item_sub_names: itemSubNames,
      item_qty: itemQty,
      amount,
      description,
      remarks
    }
  };
}

// 'Department' resolves its options from Department Master (a DB read) rather
// than the static ITEM_SUB_OPTIONS map, so it can't be folded into the
// synchronous checks above. Every other item reads ITEM_SUB_OPTIONS; an item
// with no entry there (Water Jug, Porter, Courier and Postage, Miscellaneous,
// Electricity, Internet, CUG) has no sub-categories and so accepts an empty
// selection.
//
// Several values may be chosen, so every one of them is checked — a single bad
// entry in an otherwise valid list is still rejected.
async function validateItemSubNames(itemName: string, itemSubNames: string[]): Promise<string | null> {
  if (itemName === ITEM_FROM_DEPARTMENT_MASTER) {
    if (!itemSubNames.length) return 'Select at least one department';
    const departments = await listActiveDepartments();
    const invalid = itemSubNames.find((n) => !departments.some((d) => d.name === n));
    return invalid ? `"${invalid}" is not an active department` : null;
  }

  const subs = ITEM_SUB_OPTIONS[itemName];
  if (!subs?.length) return null;
  if (!itemSubNames.length) return `Select at least one Item Name for ${itemName}`;
  const invalid = itemSubNames.find((n) => !subs.includes(n));
  return invalid ? `"${invalid}" is not a valid Item Name for ${itemName}` : null;
}
