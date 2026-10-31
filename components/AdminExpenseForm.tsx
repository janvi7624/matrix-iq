'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { UNALLOCATED_EMPLOYEE_ID } from '@/lib/adminExpenseUnallocated';
import AppShell from './AppShell';
import { useToast } from './ui/ToastProvider';
import { AdminEntry, UserOption } from './AdminExpensesView';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import styles from './adminExpenses.module.css';

const EXPENSE_TYPES = ['Hotel', 'Visa Expense', 'Bus Ticket', 'Train Ticket', 'Flight Ticket', 'Other Expense'];
// Everything except 'Other Expense' itself — used to tell "this row's
// description IS one of the fixed types" from "this row's description is
// actually a custom label someone typed under Other Expense" (the DB just
// stores whatever was typed as `description`, there's no separate is_other
// flag).
const KNOWN_TYPES = EXPENSE_TYPES.filter((t) => t !== 'Other Expense');

// Whole days between two DATEONLY ('YYYY-MM-DD') strings — used both for
// Hotel's "N night(s)" hint and a return flight's "same-day return" /
// "returns after N day(s)" hint.
function daysBetween(start: string, end: string): number {
  if (!start || !end) return 0;
  const ms = new Date(end + 'T00:00:00').getTime() - new Date(start + 'T00:00:00').getTime();
  return Math.max(0, Math.round(ms / 86400000));
}

function dateRangeHint(description: string, days: number): string {
  if (description === 'Hotel') return `${days} night${days === 1 ? '' : 's'}`;
  if (days === 0) return 'Same-day return';
  return `Returns after ${days} day${days === 1 ? '' : 's'}`;
}

function formatCurrency(n: number): string {
  return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface AdminExpenseFormProps {
  /** Present only when editing an existing batch. */
  editBatchId?: string;
}

export default function AdminExpenseForm({ editBatchId }: AdminExpenseFormProps) {
  const router = useRouter();
  const toast = useToast();

  const [users, setUsers] = useState<UserOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadingEntry, setLoadingEntry] = useState(!!editBatchId);

  const [type, setType] = useState('');
  const [date, setDate] = useState('');
  const [checkInDate, setCheckInDate] = useState('');
  const [checkOutDate, setCheckOutDate] = useState('');
  const [location, setLocation] = useState('');
  const [fromLocation, setFromLocation] = useState('');
  const [toLocation, setToLocation] = useState('');
  const [otherType, setOtherType] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
  const [empSearch, setEmpSearch] = useState('');
  // 'return' reuses the same checkOutDate state/column Hotel already uses
  // for check-out — here it means "return date" instead. Only meaningful
  // when type is Flight Ticket; Bus/Train stay one-way only, per the ask.
  const [flightTripType, setFlightTripType] = useState<'one_way' | 'return'>('one_way');

  const isTicket = type === 'Bus Ticket' || type === 'Train Ticket' || type === 'Flight Ticket';
  const isFlight = type === 'Flight Ticket';
  const isHotel = type === 'Hotel';
  const isVisa = type === 'Visa Expense';
  const isOther = type === 'Other Expense';
  const isReturnFlight = isFlight && flightTripType === 'return';
  const nights = isHotel ? daysBetween(checkInDate, checkOutDate) : 0;
  const returnGapDays = isReturnFlight ? daysBetween(date, checkOutDate) : 0;

  const amt = Number(totalAmount) || 0;
  const splitCount = selectedEmployees.length;
  const perPerson = splitCount > 0 ? Math.round((amt / splitCount) * 100) / 100 : 0;

  const filteredUsers = useMemo(() => {
    if (!empSearch.trim()) return users;
    const q = empSearch.toLowerCase();
    return users.filter((u) => u.name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q));
  }, [users, empSearch]);

  useEffect(() => {
    fetch('/api/users/lite').then((r) => (r.ok ? r.json() : [])).then((data) => setUsers(Array.isArray(data) ? data : []));
  }, []);

  useEffect(() => {
    if (!editBatchId) return;
    let cancelled = false;
    fetch(`/api/admin-expenses?batchId=${encodeURIComponent(editBatchId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        const entry = data?.entry as AdminEntry | undefined;
        if (!entry) {
          toast.error('That expense entry could not be found');
          router.push('/admin-expenses');
          return;
        }
        applyEntry(entry);
      })
      .catch(() => {
        if (cancelled) return;
        toast.error('Failed to load the expense');
        router.push('/admin-expenses');
      })
      .finally(() => { if (!cancelled) setLoadingEntry(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editBatchId]);

  function applyEntry(entry: AdminEntry) {
    const known = KNOWN_TYPES.includes(entry.description);
    setType(known ? entry.description : 'Other Expense');
    setOtherType(known ? '' : entry.description);
    setTotalAmount(String(entry.total_amount));
    setSelectedEmployees(entry.employees.map((e) => e.id));
    if (entry.description === 'Hotel') {
      setDate('');
      setCheckInDate(entry.date);
      setCheckOutDate(entry.check_out_date);
      setLocation(entry.from_location);
      setFromLocation('');
      setToLocation('');
      setFlightTripType('one_way');
    } else {
      setDate(entry.date);
      setCheckInDate('');
      setFromLocation(entry.from_location);
      setToLocation(entry.to_location);
      // Visa Expense stores its optional "Details" note in from_location,
      // same column an unrecognized/custom "Other Expense" type's note
      // lives in — everything else (ticket "From") isn't shown via
      // `location` so it stays blank there.
      setLocation(entry.description === 'Visa Expense' || !known ? entry.from_location : '');
      // A return-trip Flight Ticket has its return date in the same
      // check_out_date column Hotel uses for check-out.
      if (entry.description === 'Flight Ticket' && entry.check_out_date) {
        setFlightTripType('return');
        setCheckOutDate(entry.check_out_date);
      } else {
        setFlightTripType('one_way');
        setCheckOutDate('');
      }
    }
    setEmpSearch('');
  }

  // 'Other / Unallocated' is exclusive — a cost that belongs to nobody
  // cannot also be split between people, so picking it clears the employee
  // selection and picking an employee clears it.
  const isUnallocated = selectedEmployees.length === 1 && selectedEmployees[0] === UNALLOCATED_EMPLOYEE_ID;

  function toggleEmployee(id: string) {
    setSelectedEmployees((prev) => {
      const without = prev.filter((e) => e !== UNALLOCATED_EMPLOYEE_ID);
      return without.includes(id) ? without.filter((e) => e !== id) : [...without, id];
    });
  }

  function toggleUnallocated() {
    setSelectedEmployees((prev) =>
      prev.length === 1 && prev[0] === UNALLOCATED_EMPLOYEE_ID ? [] : [UNALLOCATED_EMPLOYEE_ID]
    );
  }

  function selectAll() {
    setSelectedEmployees(filteredUsers.map((u) => u.id));
  }

  function deselectAll() {
    setSelectedEmployees([]);
  }

  function goBack() {
    router.push('/admin-expenses');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!type) { toast.error('Select expense type'); return; }
    if (isHotel) {
      if (!checkInDate || !checkOutDate) { toast.error('Select check-in and check-out dates'); return; }
      if (checkOutDate <= checkInDate) { toast.error('Check-out date must be after check-in date'); return; }
      if (!location.trim()) { toast.error('Enter location for hotel'); return; }
    } else {
      if (!date) { toast.error('Select date'); return; }
      if (isTicket && (!fromLocation.trim() || !toLocation.trim())) { toast.error('Enter From and To for ticket'); return; }
      if (isOther && !otherType.trim()) { toast.error('Specify the expense type'); return; }
      if (isReturnFlight) {
        if (!checkOutDate) { toast.error('Select a return date'); return; }
        // Same-day return IS allowed here (unlike Hotel's checkout-after-
        // checkin rule) — that's the whole point of this field.
        if (checkOutDate < date) { toast.error('Return date cannot be before the departure date'); return; }
      }
    }
    if (!totalAmount || amt <= 0) { toast.error('Enter valid amount'); return; }
    if (!selectedEmployees.length) { toast.error('Select at least one employee, or tick Other / Unallocated'); return; }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        type,
        otherType: isOther ? otherType.trim() : undefined,
        date: isHotel ? undefined : date,
        checkInDate: isHotel ? checkInDate : undefined,
        checkOutDate: isHotel ? checkOutDate : (isReturnFlight ? checkOutDate : undefined),
        location: isHotel ? location : ((isOther || isVisa) ? location.trim() : undefined),
        fromLocation: isTicket ? fromLocation : undefined,
        toLocation: isTicket ? toLocation : undefined,
        totalAmount: amt,
        employeeIds: selectedEmployees,
      };

      let res: Response;
      if (editBatchId) {
        payload.batchId = editBatchId;
        res = await fetch('/api/admin-expenses', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch('/api/admin-expenses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      const data = await res.json().catch(() => null);
      if (!res.ok) { toast.error(data?.error || `Failed (${res.status})`); return; }
      toast.success(data?.message || (editBatchId ? 'Updated' : 'Expense added'));
      router.push('/admin-expenses');
    } catch (err) {
      console.error('Submit error:', err);
      toast.error('Network error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell title={editBatchId ? 'Edit Expense' : 'Add Expense'} subtitle="Add hotel & ticket expenses split across employees">
      <div className={styles.pageWrap}>
        <div className={styles.headerRow}>
          <h2 className={styles.headerTitle}>{editBatchId ? 'Edit Expense' : 'Add Expense'}</h2>
          <button type="button" className={historyStyles.button} onClick={goBack}>
            ← Back to register
          </button>
        </div>

        {loadingEntry ? (
          <div className={styles.centerMuted}>Loading…</div>
        ) : (
          <form onSubmit={handleSubmit}>
            {editBatchId && (
              <div className={styles.editingBanner}>
                Editing entry — changes will update all employee records in this batch
              </div>
            )}
            <div className={styles.fieldsGrid}>
              <div>
                <label className={styles.fieldLabel}>Expense Type *</label>
                <select className={`${calcStyles.formControl} ${styles.fullWidth}`} value={type} onChange={(e) => setType(e.target.value)}>
                  <option value="">Select type…</option>
                  {EXPENSE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              {isHotel ? (
                <>
                  <div>
                    <label className={styles.fieldLabel}>Check-in Date *</label>
                    <input type="date" className={`${calcStyles.formControl} ${styles.fullWidth}`} value={checkInDate} onChange={(e) => setCheckInDate(e.target.value)} />
                  </div>
                  <div>
                    <label className={styles.fieldLabel}>Check-out Date *</label>
                    <input
                      type="date"
                      className={`${calcStyles.formControl} ${styles.fullWidth}`}
                      value={checkOutDate}
                      min={checkInDate || undefined}
                      onChange={(e) => setCheckOutDate(e.target.value)}
                    />
                    {nights > 0 && <div className={styles.fieldHint}>{dateRangeHint('Hotel', nights)}</div>}
                  </div>
                  <div>
                    <label className={styles.fieldLabel}>Location *</label>
                    <input type="text" className={`${calcStyles.formControl} ${styles.fullWidth}`} placeholder="e.g. Ahmedabad" value={location} onChange={(e) => setLocation(e.target.value)} />
                  </div>
                </>
              ) : (
                <div>
                  <label className={styles.fieldLabel}>{isTicket ? 'Travel Date *' : 'Date *'}</label>
                  <input type="date" className={`${calcStyles.formControl} ${styles.fullWidth}`} value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
              )}

              {isTicket && (
                <>
                  <div>
                    <label className={styles.fieldLabel}>From *</label>
                    <input type="text" className={`${calcStyles.formControl} ${styles.fullWidth}`} placeholder="e.g. Ahmedabad" value={fromLocation} onChange={(e) => setFromLocation(e.target.value)} />
                  </div>
                  <div>
                    <label className={styles.fieldLabel}>To *</label>
                    <input type="text" className={`${calcStyles.formControl} ${styles.fullWidth}`} placeholder="e.g. Mumbai" value={toLocation} onChange={(e) => setToLocation(e.target.value)} />
                  </div>
                </>
              )}

              {isFlight && (
                <div>
                  <label className={styles.fieldLabel}>Trip Type *</label>
                  <select
                    className={`${calcStyles.formControl} ${styles.fullWidth}`}
                    value={flightTripType}
                    onChange={(e) => setFlightTripType(e.target.value as 'one_way' | 'return')}
                  >
                    <option value="one_way">One-Way</option>
                    <option value="return">Return</option>
                  </select>
                </div>
              )}

              {isReturnFlight && (
                <div>
                  <label className={styles.fieldLabel}>Return Date *</label>
                  <input
                    type="date"
                    className={`${calcStyles.formControl} ${styles.fullWidth}`}
                    value={checkOutDate}
                    min={date || undefined}
                    onChange={(e) => setCheckOutDate(e.target.value)}
                  />
                  {checkOutDate && <div className={styles.fieldHint}>{dateRangeHint('Flight Ticket', returnGapDays)}</div>}
                </div>
              )}

              {isVisa && (
                <div>
                  <label className={styles.fieldLabel}>Details (optional)</label>
                  <input type="text" className={`${calcStyles.formControl} ${styles.fullWidth}`} placeholder="e.g. US Visa, UK Visa Renewal" value={location} onChange={(e) => setLocation(e.target.value)} />
                </div>
              )}

              {isOther && (
                <>
                  <div>
                    <label className={styles.fieldLabel}>Specify Type *</label>
                    <input type="text" className={`${calcStyles.formControl} ${styles.fullWidth}`} placeholder="e.g. Taxi, Courier, Parking" value={otherType} onChange={(e) => setOtherType(e.target.value)} />
                  </div>
                  <div>
                    <label className={styles.fieldLabel}>Location / Details (optional)</label>
                    <input type="text" className={`${calcStyles.formControl} ${styles.fullWidth}`} placeholder="e.g. Ahmedabad" value={location} onChange={(e) => setLocation(e.target.value)} />
                  </div>
                </>
              )}

              <div>
                <label className={styles.fieldLabel}>Total Amount (₹) *</label>
                <input type="number" className={`${calcStyles.formControl} ${styles.fullWidth}`} placeholder="e.g. 4000" value={totalAmount} onChange={(e) => setTotalAmount(e.target.value)} min="0" step="0.01" />
              </div>
            </div>

            <div className={styles.employeesField}>
              <label className={styles.fieldLabelSpaced}>
                Select Employees * ({isUnallocated ? 'Other / Unallocated' : `${selectedEmployees.length} selected`})
              </label>

              {/* For a cost nobody is the beneficiary of — a courier fee, a
                  stall rental. Without it such an expense had to be pinned to
                  whoever happened to be picked. */}
              <label className={styles.unallocatedRow}>
                <input type="checkbox" checked={isUnallocated} onChange={toggleUnallocated} />
                <span>
                  <strong>Other / Unallocated</strong>
                  <span className={calcStyles.small}>
                    No specific employee — the full amount is recorded on its own, not split.
                  </span>
                </span>
              </label>
              <div className={styles.employeeSearchRow}>
                <input
                  type="text"
                  className={`${calcStyles.formControl} ${styles.employeeSearchInput}`}
                  placeholder="Search employees…"
                  value={empSearch}
                  onChange={(e) => setEmpSearch(e.target.value)}
                />
                <button type="button" className={`${historyStyles.button} ${styles.smallActionBtn}`} onClick={selectAll}>Select All</button>
                <button type="button" className={`${historyStyles.button} ${styles.smallActionBtn}`} onClick={deselectAll}>Clear</button>
              </div>
              <div className={styles.employeeListBox}>
                {filteredUsers.map((u) => (
                  <label key={u.id} className={styles.employeeOption} style={{
                    background: selectedEmployees.includes(u.id) ? 'var(--mx-brand-subtle, #eff6ff)' : 'transparent',
                  }}>
                    <input
                      type="checkbox"
                      checked={selectedEmployees.includes(u.id)}
                      onChange={() => toggleEmployee(u.id)}
                      className={styles.employeeCheckbox}
                    />
                    <span style={{ fontWeight: selectedEmployees.includes(u.id) ? 600 : 400 }}>
                      {u.name || u.username}
                    </span>
                  </label>
                ))}
                {filteredUsers.length === 0 && (
                  <div className={styles.employeeEmpty}>No employees found</div>
                )}
              </div>
            </div>

            {amt > 0 && splitCount > 0 && (
              <div className={styles.splitPreview}>
                <strong>Split Preview:</strong> {formatCurrency(amt)} ÷ {splitCount} employee{splitCount > 1 ? 's' : ''} = <strong>{formatCurrency(perPerson)}</strong> per person
              </div>
            )}

            <div className={styles.formButtonsRow}>
              <button type="submit" className={`${historyStyles.button} ${historyStyles.primary}`} disabled={saving}>
                {saving ? (editBatchId ? 'Updating…' : 'Adding…') : (editBatchId ? 'Update Expense' : 'Add Expense')}
              </button>
              <button type="button" className={historyStyles.button} onClick={goBack} disabled={saving}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </AppShell>
  );
}
