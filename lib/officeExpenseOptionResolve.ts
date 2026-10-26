import {
  ITEM_SUB_OPTIONS,
  OFFICE_EXPENSE_ITEMS,
  OFFICE_EXPENSE_USECASES,
  USECASE_SUB_OPTIONS
} from './officeOperationExpenseOptions';

// The hardcoded Office Operation Expense vocabulary, with whatever has been
// edited on top of it.
//
// lib/officeOperationExpenseOptions.ts remains the BASE and the single place
// a new default is added in code. This module answers "what should the form
// actually offer today", which is the base unless somebody has edited that
// particular list.
//
// NULL vs [] is the load-bearing distinction:
//   null  -> never customised, follow the code as it changes
//   []    -> somebody emptied this list on purpose
// Collapsing them would mean a list could never be emptied, or that emptying
// one silently restored five options nobody asked for.
//
// Pure — no Sequelize — so the merge and its edge cases are directly testable
// and the client can run the same logic.

export interface ExpenseOptionOverrides {
  usecases?: string[] | null;
  usecaseSubOptions?: Record<string, string[]> | null;
  items?: string[] | null;
  itemSubOptions?: Record<string, string[]> | null;
}

export interface ResolvedExpenseOptions {
  usecases: string[];
  usecaseSubOptions: Record<string, string[]>;
  items: string[];
  itemSubOptions: Record<string, string[]>;
}

export class ExpenseOptionError extends Error {}

/** Trim, drop blanks, de-duplicate case-insensitively, keep the first spelling. */
export function cleanOptionList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = String(raw ?? '').trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function cleanCatalogue(raw: unknown, allowedKeys: string[]): Record<string, string[]> {
  if (!raw || typeof raw !== 'object') return {};
  const allowed = new Map(allowedKeys.map((k) => [k.toLowerCase(), k]));
  const out: Record<string, string[]> = {};
  for (const [key, list] of Object.entries(raw as Record<string, unknown>)) {
    // A sub-list whose parent no longer exists is dropped rather than kept:
    // it can never be reached, and keeping it would silently resurrect if
    // the parent were re-added with the same name.
    const parent = allowed.get(String(key).trim().toLowerCase());
    if (!parent) continue;
    const values = cleanOptionList(list);
    if (values.length) out[parent] = values;
  }
  return out;
}

export const BASE_EXPENSE_OPTIONS: ResolvedExpenseOptions = {
  usecases: [...OFFICE_EXPENSE_USECASES],
  usecaseSubOptions: { ...USECASE_SUB_OPTIONS },
  items: [...OFFICE_EXPENSE_ITEMS],
  itemSubOptions: { ...ITEM_SUB_OPTIONS }
};

export function resolveExpenseOptions(overrides: ExpenseOptionOverrides | null | undefined): ResolvedExpenseOptions {
  const o = overrides ?? {};

  const usecases = o.usecases === null || o.usecases === undefined ? [...BASE_EXPENSE_OPTIONS.usecases] : cleanOptionList(o.usecases);
  const items = o.items === null || o.items === undefined ? [...BASE_EXPENSE_OPTIONS.items] : cleanOptionList(o.items);

  const usecaseSubOptions =
    o.usecaseSubOptions === null || o.usecaseSubOptions === undefined
      ? cleanCatalogue(BASE_EXPENSE_OPTIONS.usecaseSubOptions, usecases)
      : cleanCatalogue(o.usecaseSubOptions, usecases);

  const itemSubOptions =
    o.itemSubOptions === null || o.itemSubOptions === undefined
      ? cleanCatalogue(BASE_EXPENSE_OPTIONS.itemSubOptions, items)
      : cleanCatalogue(o.itemSubOptions, items);

  return { usecases, usecaseSubOptions, items, itemSubOptions };
}

/**
 * Validate an edit and turn it into what gets stored.
 *
 * A list identical to the base is stored as NULL rather than as a copy, so a
 * department that only edited Items keeps following the code for Categories.
 */
export function overridesFromEdit(edit: ResolvedExpenseOptions): ExpenseOptionOverrides {
  const usecases = cleanOptionList(edit.usecases);
  const items = cleanOptionList(edit.items);
  if (!usecases.length) throw new ExpenseOptionError('Category needs at least one option.');
  if (!items.length) throw new ExpenseOptionError('Item Name needs at least one option.');

  const usecaseSubOptions = cleanCatalogue(edit.usecaseSubOptions, usecases);
  const itemSubOptions = cleanCatalogue(edit.itemSubOptions, items);

  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const baseUsecaseSubs = cleanCatalogue(BASE_EXPENSE_OPTIONS.usecaseSubOptions, usecases);
  const baseItemSubs = cleanCatalogue(BASE_EXPENSE_OPTIONS.itemSubOptions, items);

  return {
    usecases: same(usecases, BASE_EXPENSE_OPTIONS.usecases) ? null : usecases,
    items: same(items, BASE_EXPENSE_OPTIONS.items) ? null : items,
    usecaseSubOptions: same(usecaseSubOptions, baseUsecaseSubs) ? null : usecaseSubOptions,
    itemSubOptions: same(itemSubOptions, baseItemSubs) ? null : itemSubOptions
  };
}
