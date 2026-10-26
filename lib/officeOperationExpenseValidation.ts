import { OfficeOperationExpenseInput } from './officeOperationExpenseStore';
import {
  ITEM_FROM_DEPARTMENT_MASTER,
  USECASE_FREE_TEXT,
  isValidOfficeLocation,
  itemIsFreeText
} from './officeOperationExpenseOptions';
import { getExpenseOptions } from './officeExpenseOptionStore';
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
  const officeLocation = str(body.officeLocation);
  const usecase = str(body.usecase);
  const usecaseDetail = str(body.usecaseDetail);
  const itemName = str(body.itemName);
  // Several sub-items may be picked on one entry. Duplicates are collapsed and
  // blanks dropped so the stored array is exactly what was chosen.
  const itemSubNames = Array.isArray(body.itemSubNames)
    ? [...new Set(body.itemSubNames.map((v: unknown) => str(v)).filter(Boolean))]
    : [];
  // description is free-text and optional; remarks now holds the required
  // "Paid By" name — one of PAID_BY_OPTIONS, or a typed name when the form's
  // 'Other' option was picked (see officeOperationExpenseOptions.ts).
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
  if (!officeLocation) return { error: 'Office Location is required' };
  if (!isValidOfficeLocation(officeLocation)) return { error: `"${officeLocation}" is not a valid office location` };
  // Checked against the RESOLVED vocabulary, not the hardcoded constants —
  // the lists are editable (lib/officeExpenseOptionStore.ts), so validating
  // against the code would reject a category someone just added.
  const options = await getExpenseOptions();
  if (!usecase) return { error: 'Category is required' };
  if (!options.usecases.includes(usecase)) return { error: `"${usecase}" is not a valid category` };
  if (!itemName) return { error: 'Expense Head is required' };
  if (!options.items.includes(itemName)) return { error: `"${itemName}" is not a valid item` };
  // Not checked against PAID_BY_OPTIONS: picking 'Other' in the form means
  // the client already resolved this to a typed name, which by definition
  // isn't one of the fixed options — only "something was provided" matters
  // here.
  if (!remarks) return { error: 'Paid By is required' };
  if (!Number.isFinite(amount) || amount <= 0) return { error: 'Amount must be greater than zero' };

  // A usecase with a fixed sub-list must carry one of its values; 'Other' must
  // carry the free-typed label (that's the only thing telling one 'Other' row
  // from another); a usecase with neither stores nothing.
  const usecaseSubs = options.usecaseSubOptions[usecase];
  const usecaseHasDetail = !!usecaseSubs || usecase === USECASE_FREE_TEXT;
  if (usecaseSubs) {
    if (!usecaseDetail) return { error: `Select which ${usecase.toLowerCase()} this is` };
    if (!usecaseSubs.includes(usecaseDetail)) return { error: `"${usecaseDetail}" is not a valid ${usecase} option` };
  } else if (usecase === USECASE_FREE_TEXT && !usecaseDetail) {
    return { error: 'Describe the category' };
  }

  const subNameError = await validateItemSubNames(itemName, itemSubNames, options.itemSubOptions);
  if (subNameError) return { error: subNameError };

  return {
    data: {
      date,
      office_location: officeLocation,
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
async function validateItemSubNames(itemName: string, itemSubNames: string[],
  itemSubOptions: Record<string, string[]>): Promise<string | null> {
  if (itemName === ITEM_FROM_DEPARTMENT_MASTER) {
    if (!itemSubNames.length) return 'Select at least one department';
    const departments = await listActiveDepartments();
    const invalid = itemSubNames.find((n) => !departments.some((d) => d.name === n));
    return invalid ? `"${invalid}" is not an active department` : null;
  }

  // No fixed list at all for these — one typed description is the whole
  // answer (see ITEM_FREE_TEXT_ITEMS' own doc comment).
  if (itemIsFreeText(itemName)) {
    if (!itemSubNames.length || !itemSubNames[0]?.trim()) return `Describe the ${itemName} expense`;
    if (itemSubNames.length > 1) return `Only one description is expected for ${itemName}`;
    return null;
  }

  const subs = itemSubOptions[itemName];
  if (!subs?.length) return null;
  if (!itemSubNames.length) return `Select at least one Item Name for ${itemName}`;
  const invalid = itemSubNames.filter((n) => !subs.includes(n));
  if (!invalid.length) return null;
  // Not one of the fixed options — allowed ONLY as the single typed
  // description standing in for 'Other' (the client never submits the
  // literal word "Other"; see handleSubmit in OfficeOperationExpensesView),
  // same reasoning as Paid By's free-typed name.
  if (!subs.includes('Other')) return `"${invalid[0]}" is not a valid Item Name for ${itemName}`;
  if (invalid.length > 1) return `Only one custom Item Name can be typed for ${itemName}`;
  return null;
}
