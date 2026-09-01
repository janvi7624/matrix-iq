'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import AppShell from './AppShell';
import { useToast } from './ui/ToastProvider';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import styles from './adminExpenses.module.css';

interface UserOption { id: string; username: string; name: string }

interface AdminEntry {
  batchId: string;
  date: string;
  description: string;
  from_location: string;
  to_location: string;
  total_amount: number;
  split_count: number;
  per_person: number;
  employees: { id: string; name: string }[];
  created_at: string;
}

const EXPENSE_TYPES = ['Hotel', 'Bus Ticket', 'Train Ticket', 'Flight Ticket'];

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
  const [location, setLocation] = useState('');
  const [fromLocation, setFromLocation] = useState('');
  const [toLocation, setToLocation] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
  const [empSearch, setEmpSearch] = useState('');

  const isTicket = type === 'Bus Ticket' || type === 'Train Ticket' || type === 'Flight Ticket';
  const isHotel = type === 'Hotel';

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
    setLocation('');
    setFromLocation('');
    setToLocation('');
    setTotalAmount('');
    setSelectedEmployees([]);
    setEmpSearch('');
    setEditBatchId(null);
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
    setType(entry.description);
    setDate(entry.date);
    setTotalAmount(String(entry.total_amount));
    setSelectedEmployees(entry.employees.map((e) => e.id));
    if (entry.description === 'Hotel') {
      setLocation(entry.from_location);
      setFromLocation('');
      setToLocation('');
    } else {
      setLocation('');
      setFromLocation(entry.from_location);
      setToLocation(entry.to_location);
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
    if (!date) { toast.error('Select date'); return; }
    if (isHotel && !location.trim()) { toast.error('Enter location for hotel'); return; }
    if (isTicket && (!fromLocation.trim() || !toLocation.trim())) { toast.error('Enter From and To for ticket'); return; }
    if (!totalAmount || amt <= 0) { toast.error('Enter valid amount'); return; }
    if (!selectedEmployees.length) { toast.error('Select at least one employee'); return; }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        type, date,
        location: isHotel ? location : undefined,
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
          <form onSubmit={handleSubmit} className={styles.formCard}>
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

              <div>
                <label className={styles.fieldLabel}>Date *</label>
                <input type="date" className={`${calcStyles.formControl} ${styles.fullWidth}`} value={date} onChange={(e) => setDate(e.target.value)} />
              </div>

              {isHotel && (
                <div>
                  <label className={styles.fieldLabel}>Location *</label>
                  <input type="text" className={`${calcStyles.formControl} ${styles.fullWidth}`} placeholder="e.g. Ahmedabad" value={location} onChange={(e) => setLocation(e.target.value)} />
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
        )}

        {loading ? (
          <div className={styles.centerMuted}>Loading…</div>
        ) : entries.length === 0 ? (
          <div className={styles.centerMutedSmall}>
            No admin expenses added yet. Click &quot;+ Add Expense&quot; to get started.
          </div>
        ) : (
          <div className={historyStyles.tableWrap}>
            <table className={historyStyles.table}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Location / Route</th>
                  <th>Total (₹)</th>
                  <th>Employees</th>
                  <th>Per Person (₹)</th>
                  <th>Added</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.batchId}>
                    <td className={styles.nowrap}>{formatDate(entry.date)}</td>
                    <td>
                      <span className={styles.typeBadge} style={{
                        background: entry.description === 'Hotel' ? '#fef3c7' : '#dbeafe',
                        color: entry.description === 'Hotel' ? '#92400e' : '#1e40af',
                      }}>
                        {entry.description}
                      </span>
                    </td>
                    <td>
                      {entry.description === 'Hotel' ? entry.from_location : `${entry.from_location} → ${entry.to_location}`}
                    </td>
                    <td className={styles.boldCell}>{formatCurrency(entry.total_amount)}</td>
                    <td>
                      <div className={styles.employeeBadgesWrap}>
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
