import { describe, it, expect } from 'vitest';
import {
  OfficeExpenseOptionsLike,
  OfficeExpenseRow,
  emptyOfficeRow,
  officeRowFlags,
  officeRowIsBlank,
  officeRowToPayload,
  officeRowsTotal,
  validateOfficeRow
} from '../../lib/officeOperationExpenseRow';
import {
  AdminExpenseRow,
  adminRowDays,
  adminRowFlags,
  adminRowIsBlank,
  adminRowToPayload,
  adminRowsTotal,
  emptyAdminRow,
  validateAdminRow
} from '../../lib/adminExpenseRow';

// The shared cores behind "Add Multiple" on Office Operation Expenses and
// Admin Expenses. Both are also used by the existing single-expense pages,
// which is the point: these rules were previously written out inside one
// form each, and a second copy would have produced rows that look right on
// screen and store differently.

const OPTIONS: OfficeExpenseOptionsLike = {
  usecases: ['Office', 'Pantry', 'Other'],
  usecaseSubOptions: { Pantry: ['Daily', 'Monthly'] },
  usecaseFreeText: 'Other',
  items: ['Pantry', 'Department', 'Maintenance', 'Rent', 'Water Jug'],
  itemSubOptions: { Pantry: ['Grocery', 'Milk', 'Other'], Department: ['Sales', 'Robotics'] },
  itemFreeTextItems: ['Maintenance', 'Rent']
};

function officeRow(over: Partial<OfficeExpenseRow> = {}): OfficeExpenseRow {
  return {
    ...emptyOfficeRow(),
    date: '2026-10-16',
    officeLocation: 'Ahmedabad',
    usecase: 'Office',
    itemName: 'Water Jug',
    amount: '500',
    remarks: 'Accounts Team',
    ...over
  };
}

describe('officeRowFlags', () => {
  it('spots a category with a fixed sub-list', () => {
    expect(officeRowFlags({ usecase: 'Pantry', itemName: '' }, OPTIONS).usecaseSubs).toEqual(['Daily', 'Monthly']);
    expect(officeRowFlags({ usecase: 'Office', itemName: '' }, OPTIONS).usecaseSubs).toBeUndefined();
  });

  it('spots the free-text category and free-text expense heads', () => {
    expect(officeRowFlags({ usecase: 'Other', itemName: '' }, OPTIONS).usecaseIsFreeText).toBe(true);
    expect(officeRowFlags({ usecase: '', itemName: 'Maintenance' }, OPTIONS).itemIsFreeText).toBe(true);
    expect(officeRowFlags({ usecase: '', itemName: 'Pantry' }, OPTIONS).itemIsFreeText).toBe(false);
  });

  // A blank field must not be treated as "the free-text option".
  it('does not treat an empty selection as free text', () => {
    expect(officeRowFlags({ usecase: '', itemName: '' }, OPTIONS).usecaseIsFreeText).toBe(false);
  });
});

describe('officeRowIsBlank', () => {
  // A trailing untouched row is scratch space, and saving must skip it
  // silently rather than reporting five validation errors.
  it('is true for a fresh row', () => {
    expect(officeRowIsBlank(emptyOfficeRow())).toBe(true);
  });

  it('is false once anything is entered', () => {
    expect(officeRowIsBlank(emptyOfficeRow({ date: '2026-10-16' }))).toBe(false);
    expect(officeRowIsBlank({ ...emptyOfficeRow(), amount: '10' })).toBe(false);
    expect(officeRowIsBlank({ ...emptyOfficeRow(), description: 'note' })).toBe(false);
  });

  // Carry-forward pre-fills date/office/category/payer, so a row that is
  // "blank" to the user is not empty in state. It must still count as blank.
  it('treats a carried-forward row with no item or amount as entered, not blank', () => {
    const carried = emptyOfficeRow({ date: '2026-10-16', officeLocation: 'Ahmedabad', usecase: 'Office', remarks: 'Accounts Team' });
    expect(officeRowIsBlank(carried)).toBe(false);
  });
});

describe('validateOfficeRow', () => {
  it('accepts a complete row', () => {
    expect(validateOfficeRow(officeRow(), OPTIONS)).toBe('');
  });

  it('requires the basics', () => {
    expect(validateOfficeRow(officeRow({ date: '' }), OPTIONS)).toMatch(/Date/);
    expect(validateOfficeRow(officeRow({ officeLocation: '' }), OPTIONS)).toMatch(/Office/);
    expect(validateOfficeRow(officeRow({ usecase: '' }), OPTIONS)).toMatch(/Category/);
    expect(validateOfficeRow(officeRow({ itemName: '' }), OPTIONS)).toMatch(/Expense head/);
    expect(validateOfficeRow(officeRow({ remarks: '' }), OPTIONS)).toMatch(/who paid/);
  });

  it('requires the category detail only when the category has one', () => {
    expect(validateOfficeRow(officeRow({ usecase: 'Pantry', itemName: 'Pantry', itemSubNames: ['Milk'] }), OPTIONS)).toMatch(/which pantry/i);
    expect(
      validateOfficeRow(officeRow({ usecase: 'Pantry', usecaseDetail: 'Daily', itemName: 'Pantry', itemSubNames: ['Milk'] }), OPTIONS)
    ).toBe('');
  });

  it('requires a description for the free-text category', () => {
    expect(validateOfficeRow(officeRow({ usecase: 'Other', usecaseDetail: '   ' }), OPTIONS)).toMatch(/Describe the category/);
  });

  it('requires at least one Item Name where the head has a list', () => {
    expect(validateOfficeRow(officeRow({ itemName: 'Pantry', itemSubNames: [] }), OPTIONS)).toMatch(/at least one Item Name/);
  });

  // Department says "department", not "Item Name" — the register's own word.
  it('words the Department case for departments', () => {
    expect(validateOfficeRow(officeRow({ itemName: 'Department', itemSubNames: [] }), OPTIONS)).toMatch(/at least one department/);
  });

  it('requires the typed description behind an "Other" sub-item', () => {
    expect(validateOfficeRow(officeRow({ itemName: 'Pantry', itemSubNames: ['Other'], itemSubOther: '' }), OPTIONS)).toMatch(/"Other"/);
  });

  it('requires the one description for a free-text expense head', () => {
    expect(validateOfficeRow(officeRow({ itemName: 'Maintenance' }), OPTIONS)).toMatch(/Describe the Maintenance/);
    expect(validateOfficeRow(officeRow({ itemName: 'Maintenance', itemFreeTextDetail: 'AC servicing' }), OPTIONS)).toBe('');
  });

  it('requires the payer name behind "Other"', () => {
    expect(validateOfficeRow(officeRow({ remarks: 'Other', remarksOther: '' }), OPTIONS)).toMatch(/name of who paid/);
  });

  // Qty is optional, but a typed nonsense value is not acceptable.
  it('allows a blank qty and rejects a bad one', () => {
    expect(validateOfficeRow(officeRow({ itemQty: '' }), OPTIONS)).toBe('');
    expect(validateOfficeRow(officeRow({ itemQty: '0' }), OPTIONS)).toMatch(/Qty/);
    expect(validateOfficeRow(officeRow({ itemQty: '-2' }), OPTIONS)).toMatch(/Qty/);
    expect(validateOfficeRow(officeRow({ itemQty: '3' }), OPTIONS)).toBe('');
  });

  it('requires a positive amount', () => {
    expect(validateOfficeRow(officeRow({ amount: '0' }), OPTIONS)).toMatch(/Amount/);
    expect(validateOfficeRow(officeRow({ amount: 'abc' }), OPTIONS)).toMatch(/Amount/);
  });
});

describe('officeRowToPayload', () => {
  // The three encodings that make this module worth sharing.
  it('replaces an "Other" sub-item with the typed description', () => {
    const payload = officeRowToPayload(
      officeRow({ itemName: 'Pantry', itemSubNames: ['Grocery', 'Other'], itemSubOther: '  Dish soap  ' }),
      OPTIONS
    );
    expect(payload.itemSubNames).toEqual(['Grocery', 'Dish soap']);
  });

  it('sends a free-text head as its single typed description', () => {
    const payload = officeRowToPayload(officeRow({ itemName: 'Rent', itemFreeTextDetail: ' Shop rent ' }), OPTIONS);
    expect(payload.itemSubNames).toEqual(['Shop rent']);
  });

  it('replaces an "Other" payer with the typed name', () => {
    const payload = officeRowToPayload(officeRow({ remarks: 'Other', remarksOther: ' Nikunj ' }), OPTIONS);
    expect(payload.remarks).toBe('Nikunj');
  });

  it('keeps a named payer as-is', () => {
    expect(officeRowToPayload(officeRow(), OPTIONS).remarks).toBe('Accounts Team');
  });

  // '' is read by the server as "not specified" and stored NULL; 0 would
  // fail its positive-number check.
  it('sends an unspecified qty as an empty string, not zero', () => {
    expect(officeRowToPayload(officeRow({ itemQty: '' }), OPTIONS).itemQty).toBe('');
  });

  it('drops the category detail when the category has none', () => {
    expect(officeRowToPayload(officeRow({ usecase: 'Office', usecaseDetail: 'leftover' }), OPTIONS).usecaseDetail).toBe('');
  });

  it('sends no sub-names for a head with no list', () => {
    expect(officeRowToPayload(officeRow({ itemName: 'Water Jug' }), OPTIONS).itemSubNames).toEqual([]);
  });

  it('sends the amount as a number', () => {
    expect(officeRowToPayload(officeRow({ amount: '1250.75' }), OPTIONS).amount).toBe(1250.75);
  });
});

describe('emptyOfficeRow carry-forward', () => {
  // What repeats down a batch, and what must not.
  it('carries the fields that repeat and clears the ones that do not', () => {
    const previous = officeRow({ itemQty: '3', description: 'milk run', itemSubNames: ['Milk'] });
    const next = emptyOfficeRow(previous);
    expect(next.date).toBe('2026-10-16');
    expect(next.officeLocation).toBe('Ahmedabad');
    expect(next.usecase).toBe('Office');
    expect(next.remarks).toBe('Accounts Team');
    expect(next.itemName).toBe('');
    expect(next.amount).toBe('');
    expect(next.itemQty).toBe('');
    expect(next.description).toBe('');
    expect(next.itemSubNames).toEqual([]);
  });

  it('gives every row its own key', () => {
    expect(emptyOfficeRow().key).not.toBe(emptyOfficeRow().key);
  });
});

describe('officeRowsTotal', () => {
  it('sums what has been typed and ignores the rest', () => {
    expect(officeRowsTotal([officeRow({ amount: '100' }), officeRow({ amount: '' }), officeRow({ amount: '50.5' })])).toBe(150.5);
  });
});

// ---------------------------------------------------------------------------
// Admin Expenses
// ---------------------------------------------------------------------------

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

describe('adminRowFlags', () => {
  it('classifies each type', () => {
    expect(adminRowFlags({ type: 'Hotel', flightTripType: 'one_way' }).isHotel).toBe(true);
    expect(adminRowFlags({ type: 'Bus Ticket', flightTripType: 'one_way' }).isTicket).toBe(true);
    expect(adminRowFlags({ type: 'Flight Ticket', flightTripType: 'one_way' }).isTicket).toBe(true);
    expect(adminRowFlags({ type: 'Other Expense', flightTripType: 'one_way' }).isOther).toBe(true);
  });

  it('only calls a flight a return flight when it is one', () => {
    expect(adminRowFlags({ type: 'Flight Ticket', flightTripType: 'return' }).isReturnFlight).toBe(true);
    expect(adminRowFlags({ type: 'Flight Ticket', flightTripType: 'one_way' }).isReturnFlight).toBe(false);
    // A bus ticket is never a return, whatever the trip-type field says.
    expect(adminRowFlags({ type: 'Bus Ticket', flightTripType: 'return' }).isReturnFlight).toBe(false);
  });
});

describe('validateAdminRow', () => {
  it('accepts a complete row', () => {
    expect(validateAdminRow(adminRow())).toBe('');
  });

  it('requires a type first', () => {
    expect(validateAdminRow(adminRow({ type: '' }))).toMatch(/type/i);
  });

  describe('hotel', () => {
    const hotel = (over: Partial<AdminExpenseRow> = {}) =>
      adminRow({ type: 'Hotel', date: '', checkInDate: '2026-10-16', checkOutDate: '2026-10-18', location: 'Pune', ...over });

    it('accepts a stay', () => {
      expect(validateAdminRow(hotel())).toBe('');
    });

    it('needs both dates and a location', () => {
      expect(validateAdminRow(hotel({ checkInDate: '' }))).toMatch(/Check-in and check-out/);
      expect(validateAdminRow(hotel({ location: '  ' }))).toMatch(/Location/);
    });

    // A one-night stay is check-in + the next day, so equal dates are wrong.
    it('requires check-out strictly after check-in', () => {
      expect(validateAdminRow(hotel({ checkOutDate: '2026-10-16' }))).toMatch(/after check-in/);
      expect(validateAdminRow(hotel({ checkOutDate: '2026-10-15' }))).toMatch(/after check-in/);
    });

    it('does not ask a hotel for a single date', () => {
      expect(validateAdminRow(hotel({ date: '' }))).toBe('');
    });
  });

  describe('tickets', () => {
    it('needs From and To', () => {
      expect(validateAdminRow(adminRow({ type: 'Train Ticket', fromLocation: '', toLocation: 'Pune' }))).toMatch(/From and To/);
    });

    it('accepts a one-way flight with no return date', () => {
      expect(
        validateAdminRow(adminRow({ type: 'Flight Ticket', fromLocation: 'AMD', toLocation: 'BOM', flightTripType: 'one_way' }))
      ).toBe('');
    });

    it('needs a return date on a return flight', () => {
      expect(
        validateAdminRow(adminRow({ type: 'Flight Ticket', fromLocation: 'AMD', toLocation: 'BOM', flightTripType: 'return' }))
      ).toMatch(/Return date is required/);
    });

    // Unlike a hotel, a same-day return IS valid — that is the whole point.
    it('allows a same-day return but not one before departure', () => {
      const base = { type: 'Flight Ticket', fromLocation: 'AMD', toLocation: 'BOM', flightTripType: 'return' as const };
      expect(validateAdminRow(adminRow({ ...base, checkOutDate: '2026-10-16' }))).toBe('');
      expect(validateAdminRow(adminRow({ ...base, checkOutDate: '2026-10-15' }))).toMatch(/before departure/);
    });
  });

  it('needs a label for Other Expense', () => {
    expect(validateAdminRow(adminRow({ type: 'Other Expense', otherType: '' }))).toMatch(/Specify/);
    expect(validateAdminRow(adminRow({ type: 'Other Expense', otherType: 'Courier' }))).toBe('');
  });

  it('needs a positive amount and at least one employee', () => {
    expect(validateAdminRow(adminRow({ totalAmount: '0' }))).toMatch(/Amount/);
    expect(validateAdminRow(adminRow({ employeeIds: [] }))).toMatch(/at least one employee/);
  });
});

describe('adminRowToPayload', () => {
  // Each type must send only its own fields — a leftover check-out date on a
  // bus ticket would otherwise be stored.
  it('sends a hotel as a stay with no single date', () => {
    const payload = adminRowToPayload(
      adminRow({ type: 'Hotel', date: '', checkInDate: '2026-10-16', checkOutDate: '2026-10-18', location: 'Pune' })
    );
    expect(payload.date).toBeUndefined();
    expect(payload.checkInDate).toBe('2026-10-16');
    expect(payload.checkOutDate).toBe('2026-10-18');
    expect(payload.location).toBe('Pune');
    expect(payload.fromLocation).toBeUndefined();
  });

  it('sends a one-way flight with no return date', () => {
    const payload = adminRowToPayload(
      adminRow({ type: 'Flight Ticket', fromLocation: 'AMD', toLocation: 'BOM', checkOutDate: '2026-10-20', flightTripType: 'one_way' })
    );
    expect(payload.checkOutDate).toBeUndefined();
    expect(payload.fromLocation).toBe('AMD');
  });

  it('sends a return flight with its return date', () => {
    const payload = adminRowToPayload(
      adminRow({ type: 'Flight Ticket', fromLocation: 'AMD', toLocation: 'BOM', checkOutDate: '2026-10-20', flightTripType: 'return' })
    );
    expect(payload.checkOutDate).toBe('2026-10-20');
  });

  it('sends no location for a ticket and no From/To for a visa', () => {
    const ticket = adminRowToPayload(adminRow({ type: 'Bus Ticket', fromLocation: 'A', toLocation: 'B', location: 'ignored' }));
    expect(ticket.location).toBeUndefined();
    const visa = adminRowToPayload(adminRow({ type: 'Visa Expense' }));
    expect(visa.fromLocation).toBeUndefined();
    expect(visa.location).toBe('Ahmedabad');
  });

  it('sends otherType only for Other Expense', () => {
    expect(adminRowToPayload(adminRow({ type: 'Other Expense', otherType: ' Courier ' })).otherType).toBe('Courier');
    expect(adminRowToPayload(adminRow({ type: 'Visa Expense', otherType: 'leftover' })).otherType).toBeUndefined();
  });

  it('sends the amount as a number and the employees as given', () => {
    const payload = adminRowToPayload(adminRow({ totalAmount: '1234.5', employeeIds: ['a', 'b'] }));
    expect(payload.totalAmount).toBe(1234.5);
    expect(payload.employeeIds).toEqual(['a', 'b']);
  });
});

describe('emptyAdminRow carry-forward', () => {
  it('carries the date and employees, not the type or amount', () => {
    const next = emptyAdminRow(adminRow({ employeeIds: ['a', 'b'] }));
    expect(next.date).toBe('2026-10-16');
    expect(next.employeeIds).toEqual(['a', 'b']);
    expect(next.type).toBe('');
    expect(next.totalAmount).toBe('');
  });

  // Carried by value — editing the new row's people must not edit the old row's.
  it('copies the employee list rather than sharing it', () => {
    const previous = adminRow({ employeeIds: ['a'] });
    const next = emptyAdminRow(previous);
    next.employeeIds.push('b');
    expect(previous.employeeIds).toEqual(['a']);
  });
});

describe('adminRowIsBlank / totals / days', () => {
  it('spots a fresh row', () => {
    expect(adminRowIsBlank(emptyAdminRow())).toBe(true);
    expect(adminRowIsBlank(emptyAdminRow({ date: '2026-10-16' }))).toBe(false);
  });

  it('sums amounts', () => {
    expect(adminRowsTotal([adminRow({ totalAmount: '100' }), adminRow({ totalAmount: 'x' })])).toBe(100);
  });

  it('counts whole days, and nothing for a missing or bad date', () => {
    expect(adminRowDays('2026-10-16', '2026-10-18')).toBe(2);
    expect(adminRowDays('2026-10-16', '2026-10-16')).toBe(0);
    expect(adminRowDays('', '2026-10-18')).toBe(0);
    expect(adminRowDays('nonsense', '2026-10-18')).toBe(0);
    // Never negative — a backwards range is a validation error, not a count.
    expect(adminRowDays('2026-10-18', '2026-10-16')).toBe(0);
  });
});
