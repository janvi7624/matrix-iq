import { db } from './db';
import {
  ExpenseOptionOverrides,
  ResolvedExpenseOptions,
  overridesFromEdit,
  resolveExpenseOptions
} from './officeExpenseOptionResolve';

// Reads and writes the one row of edited Office Operation Expense picklists.
//
// Cached for the lifetime of a request burst rather than re-read per call:
// the options route, the validator and the xlsx export each want the same
// answer within one request, and this is a single row that changes rarely.

let cached: { at: number; value: ResolvedExpenseOptions } | null = null;
const TTL_MS = 30_000;

export function invalidateExpenseOptionsCache(): void {
  cached = null;
}

async function readOverrides(): Promise<ExpenseOptionOverrides | null> {
  const row = await db.OfficeExpenseOptionSet.findOne({ where: { singleton: true } as never });
  if (!row) return null;
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  return {
    usecases: (plain.usecases as string[] | null) ?? null,
    usecaseSubOptions: (plain.usecase_sub_options as Record<string, string[]> | null) ?? null,
    items: (plain.items as string[] | null) ?? null,
    itemSubOptions: (plain.item_sub_options as Record<string, string[]> | null) ?? null
  };
}

/** What the form should offer and the validator should accept, right now. */
export async function getExpenseOptions(): Promise<ResolvedExpenseOptions> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  const value = resolveExpenseOptions(await readOverrides());
  cached = { at: Date.now(), value };
  return value;
}

/**
 * Save an edit.
 *
 * Upserts the single row. A list matching the built-in is stored as NULL by
 * overridesFromEdit, so "reset to default" is just saving the base back.
 */
export async function saveExpenseOptions(edit: ResolvedExpenseOptions, updatedBy: string | null): Promise<ResolvedExpenseOptions> {
  const overrides = overridesFromEdit(edit);
  const attrs = {
    usecases: overrides.usecases,
    usecase_sub_options: overrides.usecaseSubOptions,
    items: overrides.items,
    item_sub_options: overrides.itemSubOptions,
    singleton: true,
    updated_by: updatedBy
  };

  const row = await db.OfficeExpenseOptionSet.findOne({ where: { singleton: true } as never });
  if (row) await row.update(attrs as never);
  else await db.OfficeExpenseOptionSet.create(attrs as never);

  invalidateExpenseOptionsCache();
  return getExpenseOptions();
}
