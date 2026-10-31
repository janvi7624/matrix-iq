// Which fields an Admin Expense actually has, per type — the server side of
// the same rules lib/adminExpenseRow.ts applies in the form.
//
// Moved out of app/api/admin-expenses/route.ts so it can be tested directly:
// Next restricts what a route file may export, and this is the one function
// that decides whether a submitted expense is accepted. Unchanged from the
// version that lived there; the route imports it for POST and PUT alike.

export interface ResolvedExpenseFields {
  description: string;
  from: string;
  to: string;
  resolvedDate: string;
  // Hotel's check-out, or a return flight's return date — every other
  // type/leg leaves this null. Same column, dual meaning depending on
  // `description`, same as the client's AdminEntry.check_out_date.
  checkOut: string | null;
}

// Shared by POST and PUT — was duplicated verbatim between them before,
// which is exactly the kind of thing that drifts when one gets a fix/new
// type and the other doesn't.
export function resolveExpenseFields(body: Record<string, unknown>): ResolvedExpenseFields | { error: string } {
  const { type, date, checkInDate, checkOutDate, location, fromLocation, toLocation, otherType } = body;

  if (type === 'Hotel') {
    const from = typeof location === 'string' ? location.trim() : '';
    if (!from) return { error: 'Location is required for Hotel' };
    if (!checkInDate || !checkOutDate) return { error: 'Check-in and check-out dates are required for Hotel' };
    if (checkOutDate <= checkInDate) return { error: 'Check-out date must be after check-in date' };
    return { description: 'Hotel', from, to: '', resolvedDate: checkInDate as string, checkOut: checkOutDate as string };
  }

  if (type === 'Bus Ticket' || type === 'Train Ticket' || type === 'Flight Ticket') {
    const from = typeof fromLocation === 'string' ? fromLocation.trim() : '';
    const to = typeof toLocation === 'string' ? toLocation.trim() : '';
    if (!from || !to) return { error: 'From and To are required for ticket booking' };
    if (!date) return { error: 'Travel date is required' };
    // Return-trip flights only — Bus/Train stay one-way, no return leg was
    // asked for on those. Same-day return IS allowed (unlike Hotel's
    // checkout-must-be-after-checkin rule) since a same-day round trip is
    // the whole point of this field.
    let checkOut: string | null = null;
    if (type === 'Flight Ticket' && checkOutDate) {
      if (checkOutDate < date) return { error: 'Return date cannot be before the departure date' };
      checkOut = checkOutDate as string;
    }
    return { description: type as string, from, to, resolvedDate: date as string, checkOut };
  }

  if (type === 'Visa Expense') {
    const from = typeof location === 'string' ? location.trim() : '';
    if (!date) return { error: 'Date is required' };
    return { description: 'Visa Expense', from, to: '', resolvedDate: date as string, checkOut: null };
  }

  if (type === 'Other Expense') {
    // A free-typed expense type not covered by the fixed list — the typed
    // name itself becomes `description` (same column the fixed types store
    // their own literal name in), and location is optional here (an "other"
    // expense might not have one, e.g. a courier fee).
    const description = typeof otherType === 'string' ? otherType.trim() : '';
    if (!description) return { error: 'Please specify the expense type' };
    const from = typeof location === 'string' ? location.trim() : '';
    if (!date) return { error: 'Date is required' };
    return { description, from, to: '', resolvedDate: date as string, checkOut: null };
  }

  return { error: 'Invalid type' };
}
