// One Admin Expense, as a form row — validated and encoded in one place so
// the single-expense page and the new multi-expense page cannot disagree.
//
// The shape is unusual and worth stating: an Admin Expense is ONE cost split
// across SEVERAL employees, so a row already carries a list of people. Adding
// multiple expenses therefore means a list of rows each with its own list of
// employees, not a flat grid.
//
// The per-type field rules are the other reason this is shared. Which date
// fields apply, and whether a location means a hotel's city or a ticket's
// From/To, depends entirely on the expense type:
//
//   Hotel          check-in + check-out (check-out strictly after), location
//   Bus/Train      date, From, To
//   Flight         date, From, To, plus a return date when it is a return
//   Visa / Other   date, location; Other also needs its typed label
//
// Pure: no db/fs imports, shared by the forms and the tests.

export const ADMIN_EXPENSE_TYPES = ['Hotel', 'Visa Expense', 'Bus Ticket', 'Train Ticket', 'Flight Ticket', 'Other Expense'] as const;

export type AdminFlightTripType = 'one_way' | 'return';

export interface AdminExpenseRow {
  key: string;
  type: string;
  date: string;
  checkInDate: string;
  /** Hotel check-out, or a return flight's return date — one column, two meanings. */
  checkOutDate: string;
  location: string;
  fromLocation: string;
  toLocation: string;
  /** The typed label that stands in for 'Other Expense'. */
  otherType: string;
  totalAmount: string;
  employeeIds: string[];
  flightTripType: AdminFlightTripType;
  status: 'idle' | 'saving' | 'saved' | 'error';
  error: string;
}

let keySeq = 0;
export function nextAdminRowKey(): string {
  keySeq += 1;
  return `admin-row-${keySeq}`;
}

/**
 * A fresh row, carrying forward the date and the employee list.
 *
 * Those two are what repeat across a trip's expenses — the same people, the
 * same days, a hotel and three tickets. The type and the amount never
 * repeat, so they always start empty.
 */
export function emptyAdminRow(carryFrom?: Partial<AdminExpenseRow>): AdminExpenseRow {
  return {
    key: nextAdminRowKey(),
    type: '',
    date: carryFrom?.date ?? '',
    checkInDate: '',
    checkOutDate: '',
    location: '',
    fromLocation: '',
    toLocation: '',
    otherType: '',
    totalAmount: '',
    employeeIds: carryFrom?.employeeIds ? [...carryFrom.employeeIds] : [],
    flightTripType: 'one_way',
    status: 'idle',
    error: ''
  };
}

export interface AdminRowFlags {
  isHotel: boolean;
  isTicket: boolean;
  isFlight: boolean;
  isVisa: boolean;
  isOther: boolean;
  isReturnFlight: boolean;
}

export function adminRowFlags(row: Pick<AdminExpenseRow, 'type' | 'flightTripType'>): AdminRowFlags {
  const isFlight = row.type === 'Flight Ticket';
  return {
    isHotel: row.type === 'Hotel',
    isTicket: row.type === 'Bus Ticket' || row.type === 'Train Ticket' || isFlight,
    isFlight,
    isVisa: row.type === 'Visa Expense',
    isOther: row.type === 'Other Expense',
    isReturnFlight: isFlight && row.flightTripType === 'return'
  };
}

/** A trailing untouched row is scratch space, not a mistake. */
export function adminRowIsBlank(row: AdminExpenseRow): boolean {
  return (
    !row.type &&
    !row.date &&
    !row.checkInDate &&
    !row.checkOutDate &&
    !row.totalAmount &&
    !row.location.trim() &&
    !row.fromLocation.trim() &&
    !row.toLocation.trim() &&
    !row.otherType.trim()
  );
}

/** '' when valid, otherwise the one message for this row. */
export function validateAdminRow(row: AdminExpenseRow): string {
  const flags = adminRowFlags(row);

  if (!row.type) return 'Expense type is required';

  if (flags.isHotel) {
    if (!row.checkInDate || !row.checkOutDate) return 'Check-in and check-out dates are required';
    if (row.checkOutDate <= row.checkInDate) return 'Check-out must be after check-in';
    if (!row.location.trim()) return 'Location is required for a hotel';
  } else {
    if (!row.date) return 'Date is required';
    if (flags.isTicket && (!row.fromLocation.trim() || !row.toLocation.trim())) return 'From and To are required';
    if (flags.isOther && !row.otherType.trim()) return 'Specify the expense type';
    if (flags.isReturnFlight) {
      if (!row.checkOutDate) return 'Return date is required';
      // A same-day return IS allowed, unlike Hotel's checkout-after-checkin
      // rule — that is the whole point of the field.
      if (row.checkOutDate < row.date) return 'Return date cannot be before departure';
    }
  }

  if (!(Number(row.totalAmount) > 0)) return 'Amount must be greater than zero';
  if (!row.employeeIds.length) return 'Select at least one employee, or Other / Unallocated';
  return '';
}

/** The request body for one row, matching what the single form posts. */
export function adminRowToPayload(row: AdminExpenseRow): Record<string, unknown> {
  const flags = adminRowFlags(row);
  return {
    type: row.type,
    otherType: flags.isOther ? row.otherType.trim() : undefined,
    date: flags.isHotel ? undefined : row.date,
    checkInDate: flags.isHotel ? row.checkInDate : undefined,
    checkOutDate: flags.isHotel ? row.checkOutDate : flags.isReturnFlight ? row.checkOutDate : undefined,
    location: flags.isHotel ? row.location : flags.isOther || flags.isVisa ? row.location.trim() : undefined,
    fromLocation: flags.isTicket ? row.fromLocation : undefined,
    toLocation: flags.isTicket ? row.toLocation : undefined,
    totalAmount: Number(row.totalAmount),
    employeeIds: row.employeeIds
  };
}

export function adminRowsTotal(rows: AdminExpenseRow[]): number {
  return rows.reduce((sum, row) => sum + (Number(row.totalAmount) || 0), 0);
}

/** Whole days between two DATEONLY strings — Hotel nights, flight gap. */
export function adminRowDays(start: string, end: string): number {
  if (!start || !end) return 0;
  const ms = new Date(`${end}T00:00:00`).getTime() - new Date(`${start}T00:00:00`).getTime();
  if (Number.isNaN(ms)) return 0;
  return Math.max(0, Math.round(ms / 86_400_000));
}
