import { describe, it, expect, vi } from 'vitest';

// The client/server contract for "Add Multiple".
//
// The row tests prove the forms build the payload they intend to. These
// prove the SERVER accepts it — the same payload, through the same validator
// the real POST runs. That is the gap a unit test on either side alone
// leaves: a form can be internally consistent and still send a body the API
// rejects, and with bulk entry that failure arrives fifteen rows at a time.
//
// getExpenseOptions is stubbed with the built-in defaults so this needs no
// database, the same way officeOperationExpenseValidation.test.ts does it.
vi.mock('../../lib/officeExpenseOptionStore', async () => {
  const { resolveExpenseOptions } = await import('../../lib/officeExpenseOptionResolve');
  return {
    getExpenseOptions: vi.fn(async () => resolveExpenseOptions(null)),
    invalidateExpenseOptionsCache: vi.fn()
  };
});

import { parseExpenseBody } from '../../lib/officeOperationExpenseValidation';
import { resolveExpenseFields } from '../../lib/adminExpenseFields';
import { resolveExpenseOptions } from '../../lib/officeExpenseOptionResolve';
import { ITEM_FREE_TEXT_ITEMS, USECASE_FREE_TEXT } from '../../lib/officeOperationExpenseOptions';
import { emptyOfficeRow, officeRowToPayload, OfficeExpenseRow } from '../../lib/officeOperationExpenseRow';
import { emptyAdminRow, adminRowToPayload, AdminExpenseRow } from '../../lib/adminExpenseRow';

// Shaped exactly as /api/office-operation-expenses/options shapes it: the
// stored option set, PLUS the two free-text fields that route adds from
// constants. resolveExpenseOptions alone does not carry them, which is
// precisely the mismatch this test caught the first time it ran.
const OPTIONS = {
  ...resolveExpenseOptions(null),
  usecaseFreeText: USECASE_FREE_TEXT,
  itemFreeTextItems: [...ITEM_FREE_TEXT_ITEMS]
};

function officeRow(over: Partial<OfficeExpenseRow> = {}): OfficeExpenseRow {
  return {
    ...emptyOfficeRow(),
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

function adminRow(over: Partial<AdminExpenseRow> = {}): AdminExpenseRow {
  return {
    ...emptyAdminRow(),
    type: 'Visa Expense',
    date: '2026-10-16',
    location: 'Ahmedabad',
    totalAmount: '5000',
    employeeIds: ['emp-1'],
    ...over
  };
}

describe('Office Operation bulk rows are accepted by the API validator', () => {
  it('accepts a plain row', async () => {
    const result = await parseExpenseBody(officeRowToPayload(officeRow(), OPTIONS) as Record<string, unknown>);
    expect('error' in result ? result.error : null).toBeNull();
  });

  // The encoding that matters most: the literal word 'Other' is never sent,
  // and the server would reject it as an unknown sub-item if it were.
  it('accepts an "Other" sub-item sent as its typed description', async () => {
    const payload = officeRowToPayload(
      officeRow({ itemSubNames: ['Grocery', 'Other'], itemSubOther: 'Dish soap' }),
      OPTIONS
    ) as Record<string, unknown>;
    expect(payload.itemSubNames).toEqual(['Grocery', 'Dish soap']);
    const result = await parseExpenseBody(payload);
    expect('error' in result ? result.error : null).toBeNull();
  });

  it('accepts a free-text expense head as its one description', async () => {
    const payload = officeRowToPayload(
      officeRow({ itemName: 'Maintenance', itemSubNames: [], itemFreeTextDetail: 'AC servicing' }),
      OPTIONS
    ) as Record<string, unknown>;
    const result = await parseExpenseBody(payload);
    expect('error' in result ? result.error : null).toBeNull();
  });

  it('accepts an "Other" payer sent as the typed name', async () => {
    const payload = officeRowToPayload(officeRow({ remarks: 'Other', remarksOther: 'Nikunj' }), OPTIONS) as Record<string, unknown>;
    const result = await parseExpenseBody(payload);
    expect('error' in result ? result.error : null).toBeNull();
  });

  // '' must be read as "not specified"; 0 would fail the server's own
  // positive-number check, which is why the row sends the empty string.
  it('accepts an unspecified quantity', async () => {
    const payload = officeRowToPayload(officeRow({ itemQty: '' }), OPTIONS) as Record<string, unknown>;
    expect(payload.itemQty).toBe('');
    const result = await parseExpenseBody(payload);
    expect('error' in result ? result.error : null).toBeNull();
  });

  it('accepts a supplied quantity', async () => {
    const result = await parseExpenseBody(officeRowToPayload(officeRow({ itemQty: '4' }), OPTIONS) as Record<string, unknown>);
    expect('error' in result ? result.error : null).toBeNull();
  });

  it('accepts a category that carries its own sub-selection', async () => {
    const usecaseWithSubs = Object.keys(OPTIONS.usecaseSubOptions)[0];
    if (!usecaseWithSubs) return; // no such category in the built-in set
    const sub = OPTIONS.usecaseSubOptions[usecaseWithSubs][0];
    const result = await parseExpenseBody(
      officeRowToPayload(officeRow({ usecase: usecaseWithSubs, usecaseDetail: sub }), OPTIONS) as Record<string, unknown>
    );
    expect('error' in result ? result.error : null).toBeNull();
  });
});

describe('Admin Expense bulk rows are accepted by the API validator', () => {
  const ok = (row: AdminExpenseRow) => {
    const resolved = resolveExpenseFields(adminRowToPayload(row));
    return 'error' in resolved ? resolved.error : '';
  };

  it('accepts a visa expense', () => {
    expect(ok(adminRow())).toBe('');
  });

  it('accepts a hotel stay', () => {
    expect(
      ok(adminRow({ type: 'Hotel', date: '', checkInDate: '2026-10-16', checkOutDate: '2026-10-18', location: 'Pune' }))
    ).toBe('');
  });

  it('accepts a one-way ticket', () => {
    expect(ok(adminRow({ type: 'Train Ticket', fromLocation: 'Ahmedabad', toLocation: 'Pune' }))).toBe('');
  });

  // The dual-meaning checkOutDate column: a one-way flight must not send one.
  it('accepts a one-way flight without a return date', () => {
    expect(
      ok(adminRow({ type: 'Flight Ticket', fromLocation: 'AMD', toLocation: 'BOM', flightTripType: 'one_way', checkOutDate: '2026-10-20' }))
    ).toBe('');
  });

  it('accepts a return flight with its return date', () => {
    expect(
      ok(adminRow({ type: 'Flight Ticket', fromLocation: 'AMD', toLocation: 'BOM', flightTripType: 'return', checkOutDate: '2026-10-20' }))
    ).toBe('');
  });

  it('accepts a same-day return flight', () => {
    expect(
      ok(adminRow({ type: 'Flight Ticket', fromLocation: 'AMD', toLocation: 'BOM', flightTripType: 'return', checkOutDate: '2026-10-16' }))
    ).toBe('');
  });

  it('accepts an Other expense with its typed label', () => {
    expect(ok(adminRow({ type: 'Other Expense', otherType: 'Courier' }))).toBe('');
  });

  it('accepts every type the form offers', () => {
    const rows: AdminExpenseRow[] = [
      adminRow({ type: 'Hotel', date: '', checkInDate: '2026-10-16', checkOutDate: '2026-10-18', location: 'Pune' }),
      adminRow({ type: 'Visa Expense' }),
      adminRow({ type: 'Bus Ticket', fromLocation: 'A', toLocation: 'B' }),
      adminRow({ type: 'Train Ticket', fromLocation: 'A', toLocation: 'B' }),
      adminRow({ type: 'Flight Ticket', fromLocation: 'A', toLocation: 'B' }),
      adminRow({ type: 'Other Expense', otherType: 'Courier' })
    ];
    for (const row of rows) expect({ type: row.type, error: ok(row) }).toEqual({ type: row.type, error: '' });
  });

  // The server's own rules still bite on a bad row — proving these tests
  // would actually catch a mismatch rather than passing on anything.
  it('still rejects what the server considers invalid', () => {
    const badHotel = resolveExpenseFields({ type: 'Hotel', location: 'Pune', checkInDate: '2026-10-18', checkOutDate: '2026-10-16' });
    expect('error' in badHotel).toBe(true);
    const unknownType = resolveExpenseFields({ type: 'Not A Type' });
    expect('error' in unknownType).toBe(true);
  });
});
