// One Office Operation Expense, as a form row — validated and encoded in
// one place so the single-expense page and the new multi-expense page cannot
// disagree about what a valid entry is.
//
// This module exists because that encoding is not obvious. Three separate
// rules turn what is on screen into what gets stored:
//
//   * A sub-item of "Other" is never stored as the literal word "Other" —
//     the typed description replaces it, so the register reads what the item
//     actually was.
//   * "Paid By" does the same with its own Other.
//   * A free-text expense head (Maintenance, Rent) has no checkbox list at
//     all; its whole sub-selection IS one typed description.
//
// Duplicating those into a second form would have produced rows that look
// right on screen and store differently. Pure: no db/fs imports, so both
// 'use client' forms and the tests share it.

export interface OfficeExpenseOptionsLike {
  usecases: string[];
  usecaseSubOptions: Record<string, string[]>;
  usecaseFreeText: string;
  items: string[];
  itemSubOptions: Record<string, string[]>;
  itemFreeTextItems: string[];
}

export interface OfficeExpenseRow {
  key: string;
  date: string;
  officeLocation: string;
  usecase: string;
  usecaseDetail: string;
  itemName: string;
  itemSubNames: string[];
  /** Replaces the literal 'Other' among itemSubNames when submitted. */
  itemSubOther: string;
  /** The whole sub-selection for a free-text expense head (Maintenance, Rent). */
  itemFreeTextDetail: string;
  itemQty: string;
  amount: string;
  description: string;
  /** "Paid By" — one of PAID_BY_OPTIONS, or 'Other' with remarksOther set. */
  remarks: string;
  remarksOther: string;
  status: 'idle' | 'saving' | 'saved' | 'error';
  error: string;
}

let keySeq = 0;
/** Row identity. Index is not usable as a key — rows get removed mid-list. */
export function nextOfficeRowKey(): string {
  keySeq += 1;
  return `office-row-${keySeq}`;
}

/**
 * A fresh row, optionally carrying forward the fields that are almost always
 * the same down a batch.
 *
 * Date, office, category and who paid repeat for every line of a day's
 * shopping; the item and the amount never do. Carrying the first group is
 * what makes entering fifteen expenses different from entering one fifteen
 * times — the same reason ReimbursementBulkAddForm carries date, employees
 * and payment mode.
 */
export function emptyOfficeRow(carryFrom?: Partial<OfficeExpenseRow>): OfficeExpenseRow {
  return {
    key: nextOfficeRowKey(),
    date: carryFrom?.date ?? '',
    officeLocation: carryFrom?.officeLocation ?? '',
    usecase: carryFrom?.usecase ?? '',
    usecaseDetail: carryFrom?.usecaseDetail ?? '',
    itemName: '',
    itemSubNames: [],
    itemSubOther: '',
    itemFreeTextDetail: '',
    itemQty: '',
    amount: '',
    description: '',
    remarks: carryFrom?.remarks ?? '',
    remarksOther: carryFrom?.remarksOther ?? '',
    status: 'idle',
    error: ''
  };
}

export interface OfficeRowFlags {
  /** The fixed sub-list for this category, when it has one. */
  usecaseSubs: string[] | undefined;
  usecaseIsFreeText: boolean;
  /** The fixed Item Name list for this expense head, when it has one. */
  itemSubs: string[] | undefined;
  itemIsFreeText: boolean;
}

/**
 * The same four derived flags the single form computes, in one place.
 *
 * Every lookup is defensive. The options come from a fetch, and the two
 * free-text fields in particular are added by the options ROUTE from
 * constants rather than coming out of the stored option set — so a caller
 * holding a server-shaped ResolvedExpenseOptions has neither of them. A
 * missing list should mean "no free-text heads", not a crash that takes the
 * whole form down mid-entry.
 */
export function officeRowFlags(row: Pick<OfficeExpenseRow, 'usecase' | 'itemName'>, options: OfficeExpenseOptionsLike): OfficeRowFlags {
  return {
    usecaseSubs: row.usecase ? options.usecaseSubOptions?.[row.usecase] : undefined,
    usecaseIsFreeText: !!row.usecase && !!options.usecaseFreeText && row.usecase === options.usecaseFreeText,
    itemSubs: row.itemName ? options.itemSubOptions?.[row.itemName] : undefined,
    itemIsFreeText: !!row.itemName && (options.itemFreeTextItems ?? []).includes(row.itemName)
  };
}

/**
 * True when nothing has been entered — a trailing blank row is unused
 * scratch space, not a mistake, and must be skipped silently on save.
 */
export function officeRowIsBlank(row: OfficeExpenseRow): boolean {
  return (
    !row.date &&
    !row.officeLocation &&
    !row.usecase &&
    !row.itemName &&
    !row.amount &&
    !row.itemSubNames.length &&
    !row.description.trim() &&
    !row.remarks
  );
}

/** '' when the row is valid, otherwise the one message to show on it. */
export function validateOfficeRow(row: OfficeExpenseRow, options: OfficeExpenseOptionsLike): string {
  const flags = officeRowFlags(row, options);

  if (!row.date) return 'Date is required';
  if (!row.officeLocation) return 'Office location is required';
  if (!row.usecase) return 'Category is required';
  if (flags.usecaseSubs && !row.usecaseDetail) return `Select which ${row.usecase.toLowerCase()} this is`;
  if (flags.usecaseIsFreeText && !row.usecaseDetail.trim()) return 'Describe the category';
  if (!row.itemName) return 'Expense head is required';
  if (flags.itemSubs?.length && !row.itemSubNames.length) {
    return row.itemName === 'Department' ? 'Select at least one department' : `Select at least one Item Name for ${row.itemName}`;
  }
  if (row.itemSubNames.includes('Other') && !row.itemSubOther.trim()) return `Describe the "Other" ${row.itemName} item`;
  if (flags.itemIsFreeText && !row.itemFreeTextDetail.trim()) return `Describe the ${row.itemName} expense`;
  if (!row.remarks) return 'Select who paid';
  if (row.remarks === 'Other' && !row.remarksOther.trim()) return 'Enter the name of who paid';
  // Qty is optional — only rejected when something was typed that is not a
  // usable number.
  if (row.itemQty.trim() && !(Number(row.itemQty) > 0)) return 'Item Qty must be greater than zero';
  if (!(Number(row.amount) > 0)) return 'Amount must be greater than zero';
  return '';
}

/**
 * The request body for one row — the same encoding the single form applies,
 * including both 'Other' substitutions and the free-text head.
 */
export function officeRowToPayload(row: OfficeExpenseRow, options: OfficeExpenseOptionsLike): Record<string, unknown> {
  const flags = officeRowFlags(row, options);
  return {
    date: row.date,
    officeLocation: row.officeLocation,
    usecase: row.usecase,
    usecaseDetail: flags.usecaseSubs || flags.usecaseIsFreeText ? row.usecaseDetail : '',
    itemName: row.itemName,
    itemSubNames: flags.itemIsFreeText
      ? [row.itemFreeTextDetail.trim()]
      : flags.itemSubs?.length
        ? row.itemSubNames.map((n) => (n === 'Other' ? row.itemSubOther.trim() : n))
        : [],
    // '' rather than 0 — the server reads '' as "not specified" and stores
    // NULL, where 0 would fail its positive-number check.
    itemQty: row.itemQty.trim(),
    amount: Number(row.amount),
    description: row.description,
    remarks: row.remarks === 'Other' ? row.remarksOther.trim() : row.remarks
  };
}

/** Running total of whatever has been typed so far. */
export function officeRowsTotal(rows: OfficeExpenseRow[]): number {
  return rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
}
