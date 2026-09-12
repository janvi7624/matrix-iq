'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import AppShell from './AppShell';
import Modal from './ui/Modal';
import { useToast } from './ui/ToastProvider';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import styles from './adminExpenses.module.css';

interface UserOption { id: string; username: string; name: string }

interface AdminEntry {
  batchId: string;
  date: string;
  check_out_date: string;
  description: string;
  from_location: string;
  to_location: string;
  total_amount: number;
  split_count: number;
  per_person: number;
  employees: { id: string; name: string }[];
  created_at: string;
}

// Whole days between two DATEONLY ('YYYY-MM-DD') strings — used both for
// Hotel's "N night(s)" hint and a return flight's "same-day return" /
// "returns after N day(s)" hint, so either date-range's split amount has
// obvious context instead of just a bare range.
function daysBetween(start: string, end: string): number {
  if (!start || !end) return 0;
  const ms = new Date(end + 'T00:00:00').getTime() - new Date(start + 'T00:00:00').getTime();
  return Math.max(0, Math.round(ms / 86400000));
}

// Hotel says "nights stayed"; a return flight says "same-day return" or how
// many days later it comes back — same underlying day-diff, different words
// depending on which type of date range this is.
function dateRangeHint(description: string, days: number): string {
  if (description === 'Hotel') return `${days} night${days === 1 ? '' : 's'}`;
  if (days === 0) return 'Same-day return';
  return `Returns after ${days} day${days === 1 ? '' : 's'}`;
}

const EXPENSE_TYPES = ['Hotel', 'Visa Expense', 'Bus Ticket', 'Train Ticket', 'Flight Ticket', 'Other Expense'];
// Everything except 'Other Expense' itself — used to tell "this row's
// description IS one of the fixed types" from "this row's description is
// actually a custom label someone typed under Other Expense" (the DB just
// stores whatever was typed as `description`, there's no separate is_other
// flag).
const KNOWN_TYPES = EXPENSE_TYPES.filter((t) => t !== 'Other Expense');

function formatDate(iso: string): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return iso; }
}

function formatCurrency(n: number): string {
  return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function AdminExpensesView() {
  const toast = useToast();
  const [users, setUsers] = useState<UserOption[]>([]);
  const [entries, setEntries] = useState<AdminEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const [editBatchId, setEditBatchId] = useState<string | null>(null);
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

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin-expenses');
      const data = await res.json();
      if (res.ok) {
        setEntries(data.entries || []);
      } else {
        console.error('Failed to fetch admin expenses:', data.error);
      }
    } catch (err) { console.error('Admin expenses fetch error:', err); }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetch('/api/users/lite').then((r) => r.ok ? r.json() : []).then((data) => setUsers(Array.isArray(data) ? data : []));
    fetchEntries();
  }, [fetchEntries]);

  function resetForm() {
    setType('');
    setDate('');
    setCheckInDate('');
    setCheckOutDate('');
    setLocation('');
    setFromLocation('');
    setToLocation('');
    setOtherType('');
    setTotalAmount('');
    setSelectedEmployees([]);
    setEmpSearch('');
    setEditBatchId(null);
    setFlightTripType('one_way');
  }

  function toggleEmployee(id: string) {
    setSelectedEmployees((prev) => prev.includes(id) ? prev.filter((e) => e !== id) : [...prev, id]);
  }

  function selectAll() {
    setSelectedEmployees(filteredUsers.map((u) => u.id));
  }

  function deselectAll() {
    setSelectedEmployees([]);
  }

  function startEdit(entry: AdminEntry) {
    setEditBatchId(entry.batchId);
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
    setShowForm(true);
  }

  async function handleDelete(batchId: string) {
    if (!confirm('Delete this expense entry? This will remove the split amounts from all employees.')) return;
    setDeleting(batchId);
    try {
      const res = await fetch(`/api/admin-expenses?batchId=${encodeURIComponent(batchId)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Failed to delete'); return; }
      toast.success(data.message || 'Deleted');
      fetchEntries();
    } catch { toast.error('Network error'); }
    finally { setDeleting(null); }
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
    if (!selectedEmployees.length) { toast.error('Select at least one employee'); return; }

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
      resetForm();
      setShowForm(false);
      await fetchEntries();
    } catch (err) { console.error('Submit error:', err); toast.error('Network error'); }
    finally { setSaving(false); }
  }

  return (
    <AppShell title="Admin Expenses" subtitle="Add hotel & ticket expenses split across employees">
      <div className={styles.pageWrap}>
        <div className={styles.headerRow}>
          <h2 className={styles.headerTitle}>Admin Expenses</h2>
          <button
            type="button"
            className={`${historyStyles.button} ${historyStyles.primary}`}
            onClick={() => { if (showForm) { resetForm(); setShowForm(false); } else { resetForm(); setShowForm(true); } }}
          >
            {showForm ? 'Cancel' : '+ Add Expense'}
          </button>
        </div>

        {showForm && (
          <Modal
            title={editBatchId ? 'Edit Expense' : 'Add Expense'}
            ariaLabel={editBatchId ? 'Edit Expense' : 'Add Expense'}
            onClose={() => { resetForm(); setShowForm(false); }}
            size="wide"
            dismissible={!saving}
          >
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
                Select Employees * ({selectedEmployees.length} selected)
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
              <button type="button" className={historyStyles.button} onClick={() => { resetForm(); setShowForm(false); }}>
                Cancel
              </button>
            </div>
          </form>
          </Modal>
        )}

        {loading ? (
          <div className={styles.centerMuted}>Loading…</div>
        ) : entries.length === 0 ? (
          <div className={styles.centerMutedSmall}>
            No admin expenses added yet. Click &quot;+ Add Expense&quot; to get started.
          </div>
        ) : (
          <div className={historyStyles.tableWrap}>
            <table className={`${historyStyles.table} ${historyStyles.tableFixed}`}>
              <thead>
                <tr>
                  <th className={styles.colDate}>Date</th>
                  <th className={styles.colType}>Type</th>
                  <th className={styles.colRoute}>Location / Route</th>
                  <th className={styles.colTotal}>Total (₹)</th>
                  <th className={styles.colEmployees}>Employees</th>
                  <th className={styles.colPerPerson}>Per Person (₹)</th>
                  <th className={styles.colAdded}>Added</th>
                  <th className={styles.colActions}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.batchId}>
                    <td className={styles.nowrap}>
                      {/* Any type can carry a check_out_date now (Hotel's
                          own check-out, or a return flight's return date) —
                          both get the same range + day-count treatment. */}
                      {entry.check_out_date ? (
                        <>
                          {formatDate(entry.date)} → {formatDate(entry.check_out_date)}
                          <div className={styles.fieldHint}>{dateRangeHint(entry.description, daysBetween(entry.date, entry.check_out_date))}</div>
                        </>
                      ) : (
                        formatDate(entry.date)
                      )}
                    </td>
                    <td>
                      <span className={styles.typeBadge} style={{
                        background: entry.description === 'Hotel' ? '#fef3c7' : entry.description === 'Visa Expense' ? '#ede9fe' : '#dbeafe',
                        color: entry.description === 'Hotel' ? '#92400e' : entry.description === 'Visa Expense' ? '#5b21b6' : '#1e40af',
                      }}>
                        {entry.description}
                      </span>
                    </td>
                    <td>
                      {entry.to_location ? `${entry.from_location} → ${entry.to_location}` : (entry.from_location || '—')}
                    </td>
                    <td className={styles.boldCell}>{formatCurrency(entry.total_amount)}</td>
                    <td className={styles.colEmployees}>
                      {/* Collapsed by default (row stays single-line, no
                          horizontal scroll) — hovering the row swaps to the
                          full list via pure CSS (tr:hover below), no click
                          or popover needed. */}
                      <div className={styles.employeeCollapsed}>
                        {entry.employees.slice(0, 2).map((emp) => (
                          <span key={emp.id} className={styles.employeeBadge}>
                            {emp.name}
                          </span>
                        ))}
                        {entry.employees.length > 2 && (
                          <span className={styles.employeeMoreText}>+{entry.employees.length - 2}</span>
                        )}
                      </div>
                      <div className={styles.employeeExpanded}>
                        {entry.employees.map((emp) => (
                          <span key={emp.id} className={styles.employeeBadge}>
                            {emp.name}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className={styles.perPersonCell}>{formatCurrency(entry.per_person)}</td>
                    <td className={styles.addedCell}>
                      {formatDate(entry.created_at)}
                    </td>
                    <td>
                      <div className={styles.rowActions}>
                        <button
                          type="button"
                          onClick={() => startEdit(entry)}
                          className={styles.editRowBtn}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(entry.batchId)}
                          disabled={deleting === entry.batchId}
                          className={styles.deleteRowBtn}
                          style={{ opacity: deleting === entry.batchId ? 0.5 : 1 }}
                        >
                          {deleting === entry.batchId ? '…' : 'Delete'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
