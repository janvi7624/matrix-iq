// The Office Operation Expense Management picklists, in one place so the form
// (components/OfficeOperationExpensesView.tsx), the API's validation
// (app/api/office-operation-expenses), and the xlsx export all agree on what
// a valid Usecase / Item Name is. Adding an option here is the only edit
// needed to surface it everywhere — none of these are stored in a lookup
// table, deliberately: they're a fixed business vocabulary, not admin-editable
// master data like Department Master or Product Master.

// Surfaced in the UI and the Excel sheet as "Category" — the identifiers and
// the `usecase` / `usecase_detail` DB columns keep the original name on
// purpose: renaming them would mean a migration and a sweep through the store,
// API and options route for no user-visible gain.
//
// 'Pantry' deliberately absent — pantry spend is tracked as an Item Name
// (see OFFICE_EXPENSE_ITEMS below) rather than a usecase, so it isn't
// recorded at two different levels of the same entry.
export const OFFICE_EXPENSE_USECASES = [
  'Office',
  'Employee',
  'Guest',
  'Director',
  'Salary'
] as const;

// Second level of `usecase`, for usecases that need one. Deliberately EMPTY:
// 'Salary' used to offer Sweeper Salary / Office Boy here, but that duplicated
// what the Expense Head already says (item 'Salary' with its own sub-items
// Sweeper / Papa), so the same fact was being entered twice.
//
// A usecase absent from this map renders no sub-field at all, so adding an
// entry here is the only change needed to bring one back.
export const USECASE_SUB_OPTIONS: Record<string, string[]> = {};

// The usecase whose detail is typed rather than picked. 'Other' has since been
// removed from OFFICE_EXPENSE_USECASES, so nothing matches this today and no
// entry can carry a usecase detail at all — the machinery is kept (rather than
// ripped out of the form, validation and options route) purely as the
// extension point for whenever a free-text usecase is wanted again.
export const USECASE_FREE_TEXT = 'Other';

export const OFFICE_EXPENSE_ITEMS = [
  'Stationary and Printing',
  'Pantry',
  'Water Jug',
  'Porter',
  'Courier and Postage',
  'Tempo',
  'Miscellaneous',
  'Electricity',
  'Internet',
  'CUG',
  'IT Materials',
  'Salary',
  'Legal',
  'HR',
  'Department',
  'Godown 30',
  'Godown 31',
  'Flowers',
  'Maintenance',
  'Rent',
  'Training',
  // Expo and event spend — stall, printing, travel, hospitality and the rest
  // of it. Deliberately no ITEM_SUB_OPTIONS entry: what an event costs varies
  // every time, so a fixed sub-list would either be wrong or be mostly
  // 'Other', and an entry already carries `description` and `remarks` for the
  // detail. Appended rather than slotted in alphabetically — the list is
  // grouped by kind, not sorted, and this sits next to Training.
  'EXPO / Event'
] as const;

// Items whose detail is typed rather than picked from a fixed list — the
// item-level counterpart to USECASE_FREE_TEXT above, and a different shape
// from ITEM_SUB_OPTIONS' per-item 'Other' escape hatch: there is no fixed
// list to pick from at all here, just one blank. An item listed here must
// NOT also have an ITEM_SUB_OPTIONS entry — the form renders one or the
// other, never both.
//
// Maintenance and Rent are two separate Expense Heads, each with its own
// blank, NOT one combined "Maintenance & Rent" item — they're different
// kinds of spend and belong in the register as different rows.
export const ITEM_FREE_TEXT_ITEMS = ['Maintenance', 'Rent'] as const;

export function itemIsFreeText(itemName: string): boolean {
  return (ITEM_FREE_TEXT_ITEMS as readonly string[]).includes(itemName);
}

// Godown 30 and Godown 31 are two premises billed the same way, so they share
// one list rather than repeating it — edit here and both stay in step.
const GODOWN_SUB_OPTIONS = ['Rent', 'Maintenance', 'Tax', 'Water', 'Tea', 'Mobile Bill', 'Light Bill'];

// Per-item sub-item lists. An item present here renders a required MULTI-select
// in the form — several sub-items can belong to one entry — and every chosen
// value is validated server-side against this exact list; an item ABSENT here
// renders no sub-field at all and accepts an empty selection (Water Jug,
// Porter, Courier and Postage, Miscellaneous, Electricity, Internet and CUG are
// all intentionally in that group — no sub-categories were defined for them).
//
// 'Department' is listed for completeness but its values are replaced at
// request time with live Department Master data — see
// ITEM_FROM_DEPARTMENT_MASTER below and the /options route.
export const ITEM_SUB_OPTIONS: Record<string, string[]> = {
  'Stationary and Printing': ['Xerox', 'Color Print', 'Stationery Items', 'Other'],
  Pantry: ['Milk', 'Tea', 'Tea Powder', 'Coffee Powder', 'Sugar', 'Ginger', 'Lemon', 'Phudino', 'Green Tea', 'Snacks', 'Lunch', 'Dinner', 'Coffee', 'Grocery', 'Water Bottle', 'Other'],
  Tempo: ['Fastag', 'Insurance', 'Tax', 'CNG', 'Petrol'],
  'IT Materials': ['Laptop', 'Mouse', 'Chargers', 'Repair', 'Keyboards', 'Other'],
  Salary: ['Sweeper', 'Parin', 'Papa', 'Other'],
  Legal: ['Stamp Duty', 'Notary', 'Bank', 'Other'],
  HR: ['Birthday Card', 'Appreciation Card & Amount', 'Yearly Anniversary Card', 'Gift Voucher', 'T-Shirt', 'Festival Celebration', 'Training'],
  'Godown 30': GODOWN_SUB_OPTIONS,
  'Godown 31': GODOWN_SUB_OPTIONS
};

// 'Department' means "any one of the org's departments", so its sub-list comes
// from Department Master at request time instead of being hardcoded above —
// the form fetches it, and this constant is what both sides key off.
export const ITEM_FROM_DEPARTMENT_MASTER = 'Department';

export function isValidUsecase(value: string): boolean {
  return (OFFICE_EXPENSE_USECASES as readonly string[]).includes(value);
}

export function isValidItem(value: string): boolean {
  return (OFFICE_EXPENSE_ITEMS as readonly string[]).includes(value);
}

// Which office this expense was incurred for/by. Required on every new entry
// (see lib/officeOperationExpenseValidation.ts); historical entries predate
// it and store '' — see the migration.
export const OFFICE_LOCATIONS = ['Ahmedabad', 'Mumbai'] as const;
export type OfficeLocation = (typeof OFFICE_LOCATIONS)[number];

export function isValidOfficeLocation(value: string): value is OfficeLocation {
  return (OFFICE_LOCATIONS as readonly string[]).includes(value);
}

// Who fronted this expense — a fixed, short list of people/teams who actually
// pay out of pocket for office spend, NOT the same thing as the `paid_by`
// column on this same DB row (a UUID set by Accounts when the expense is
// later settled/reimbursed — see lib/accountsPaymentStore.ts). This picklist
// is stored in the `remarks` column instead (free-text notes was this form's
// previous use of that field, replaced rather than kept alongside it).
//
// 'Other' is a trigger, not a storable value: picking it opens a required
// free-text name field in the form, and the typed name is what actually gets
// submitted as `remarks` — so the DB never has to distinguish "one of the
// three named options" from "a name someone typed," and a new person paying
// out of pocket doesn't need this list edited first.
export const PAID_BY_OPTIONS = ['Hardik Acharya', 'Pragnesh Trivedi', 'Accounts Team', 'Other'] as const;
export type PaidByOption = (typeof PAID_BY_OPTIONS)[number];
