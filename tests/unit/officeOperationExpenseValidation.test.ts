import { describe, it, expect } from 'vitest';
import { parseExpenseBody } from '../../lib/officeOperationExpenseValidation';
import {
  ITEM_FREE_TEXT_ITEMS,
  ITEM_SUB_OPTIONS,
  OFFICE_EXPENSE_ITEMS,
  isValidItem,
  itemIsFreeText
} from '../../lib/officeOperationExpenseOptions';

// Covers the 'Other' escape hatch for an Item Name sub-selection (e.g.
// Pantry -> Other -> a typed description) — the server-side counterpart to
// components/OfficeOperationExpensesView.tsx's itemSubOther field. No DB
// access needed: that only happens for itemName === 'Department', which
// none of these exercise.

function body(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    date: '2026-10-16',
    officeLocation: 'Ahmedabad',
    usecase: 'Office',
    itemName: 'Pantry',
    itemSubNames: ['Grocery'],
    amount: '500',
    remarks: 'Accounts Team',
    ...over
  };
}

describe('Item Name sub-selection — the Other escape hatch', () => {
  it('accepts a plain selection from the fixed list', async () => {
    const result = await parseExpenseBody(body());
    expect('data' in result).toBe(true);
  });

  it('accepts a typed description standing in for Other, alongside real selections', async () => {
    const result = await parseExpenseBody(body({ itemSubNames: ['Grocery', 'Water filter cartridge'] }));
    expect('data' in result).toBe(true);
    if ('data' in result) expect(result.data.item_sub_names).toEqual(['Grocery', 'Water filter cartridge']);
  });

  it('accepts the literal word "Other" itself (the client is expected to have already resolved it, same as Paid By)', async () => {
    const result = await parseExpenseBody(body({ itemSubNames: ['Other'] }));
    expect('data' in result).toBe(true);
  });

  it('rejects two different typed descriptions on one entry', async () => {
    const result = await parseExpenseBody(body({ itemSubNames: ['Custom A', 'Custom B'] }));
    expect('error' in result).toBe(true);
  });

  it('rejects an unrecognised value for an item with no Other escape hatch at all', async () => {
    // Tempo's sub-list (Fastag/Insurance/Tax/CNG/Petrol) has no 'Other'.
    const result = await parseExpenseBody(body({ itemName: 'Tempo', itemSubNames: ['Something made up'] }));
    expect('error' in result).toBe(true);
    if ('error' in result) expect(result.error).toContain('Tempo');
  });

  it('still rejects a genuinely unknown value for an item that DOES have Other, once a custom slot is already used', async () => {
    const result = await parseExpenseBody(body({ itemSubNames: ['Grocery', 'Custom A', 'Custom B'] }));
    expect('error' in result).toBe(true);
  });
});

describe.each(['Maintenance', 'Rent'])('%s — a free-text Expense Head with no fixed list at all', (itemName) => {
  it('accepts one typed description', async () => {
    const result = await parseExpenseBody(body({ itemName, itemSubNames: ['A description'] }));
    expect('data' in result).toBe(true);
    if ('data' in result) expect(result.data.item_sub_names).toEqual(['A description']);
  });

  it('rejects an empty selection — unlike Water Jug/Porter/etc., this one always needs its one description', async () => {
    const result = await parseExpenseBody(body({ itemName, itemSubNames: [] }));
    expect('error' in result).toBe(true);
  });

  it('rejects a blank/whitespace-only description', async () => {
    const result = await parseExpenseBody(body({ itemName, itemSubNames: ['   '] }));
    expect('error' in result).toBe(true);
  });

  it('rejects more than one description', async () => {
    const result = await parseExpenseBody(body({ itemName, itemSubNames: ['First', 'Second'] }));
    expect('error' in result).toBe(true);
  });

  it('does not accidentally accept the OTHER free-text item\'s name as if it were a fixed-list sub-option', async () => {
    // Guards against the two sharing a list by accident now that they're
    // split — each is independently free-text, neither is a valid
    // "sub-option of" the other.
    const other = itemName === 'Maintenance' ? 'Rent' : 'Maintenance';
    const result = await parseExpenseBody(body({ itemName, itemSubNames: [other, 'Second'] }));
    expect('error' in result).toBe(true);
  });
});

// Structural checks on the picklists themselves, rather than on one request.
// lib/officeOperationExpenseOptions.ts states these rules in comments and
// nothing enforced them, so a new Expense Head could be added in a shape the
// form cannot render — and the failure is silent: a mis-keyed sub-option map
// renders no sub-field at all rather than erroring.
describe('Expense Head picklist shape', () => {
  it('never lists one head as both a fixed sub-list and a free-text blank', () => {
    // The form renders one or the other, never both, so an item in both lists
    // would be unreachable one way or the other.
    const both = (ITEM_FREE_TEXT_ITEMS as readonly string[]).filter((item) => item in ITEM_SUB_OPTIONS);
    expect(both).toEqual([]);
  });

  it('keys every sub-option list to a head that actually exists', () => {
    // A typo here ('Stationery and Printing' for 'Stationary and Printing')
    // silently drops the sub-field instead of failing.
    const unknown = Object.keys(ITEM_SUB_OPTIONS).filter(
      (key) => !(OFFICE_EXPENSE_ITEMS as readonly string[]).includes(key)
    );
    expect(unknown).toEqual([]);
  });

  it('names a real head in the free-text list too', () => {
    const unknown = (ITEM_FREE_TEXT_ITEMS as readonly string[]).filter(
      (item) => !(OFFICE_EXPENSE_ITEMS as readonly string[]).includes(item)
    );
    expect(unknown).toEqual([]);
  });

  it('lists no head twice', () => {
    // A duplicate shows the option twice in the dropdown.
    const seen = new Set<string>();
    const duplicates = (OFFICE_EXPENSE_ITEMS as readonly string[]).filter((item) => {
      if (seen.has(item)) return true;
      seen.add(item);
      return false;
    });
    expect(duplicates).toEqual([]);
  });

  it('offers EXPO / Event, with no sub-selection to make', () => {
    // Event spend varies every time, so the detail goes in the entry's own
    // description/remarks rather than a fixed sub-list.
    expect(isValidItem('EXPO / Event')).toBe(true);
    expect(ITEM_SUB_OPTIONS['EXPO / Event']).toBeUndefined();
    expect(itemIsFreeText('EXPO / Event')).toBe(false);
  });
});
