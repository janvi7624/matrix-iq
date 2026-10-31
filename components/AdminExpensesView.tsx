'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from './AppShell';
import { useToast } from './ui/ToastProvider';
import AdminExpenseBulkForm from './AdminExpenseBulkForm';
import historyStyles from './quotationHistory.module.css';
import styles from './adminExpenses.module.css';

export interface UserOption { id: string; username: string; name: string }

export interface AdminEntry {
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
  approval_status: 'pending_approval' | 'approved';
  approved_by_name: string;
  approved_at: string;
}

// Must match APPROVER_USERNAME in lib/adminExpenseAccess.ts — only this
// person sees the Approve action, since it's a named-approver requirement
// rather than a role check.
const APPROVER_USERNAME = 'hardik.acharya';

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

export default function AdminExpensesView({ currentUser }: { currentUser: { username: string } }) {
  const toast = useToast();
  const router = useRouter();
  const isApprover = currentUser.username === APPROVER_USERNAME;
  const [entries, setEntries] = useState<AdminEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [approving, setApproving] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);

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
    fetchEntries();
  }, [fetchEntries]);

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

  async function handleApprove(batchId: string) {
    setApproving(batchId);
    try {
      const res = await fetch(`/api/admin-expenses/${encodeURIComponent(batchId)}/approve`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Failed to approve'); return; }
      toast.success(data.message || 'Approved');
      fetchEntries();
    } catch { toast.error('Network error'); }
    finally { setApproving(null); }
  }

  return (
    <AppShell title="Admin Expenses" subtitle="Add hotel & ticket expenses split across employees">
      <div className={styles.pageWrap}>
        <div className={styles.headerRow}>
          <h2 className={styles.headerTitle}>Admin Expenses</h2>
          <div className={styles.headerActions}>
            {/* Same pair of entry points reimbursement and Office Operation
                offer: one expense gets its own page, several are entered
                inline here. */}
            <button type="button" className={historyStyles.button} onClick={() => setBulkOpen((v) => !v)}>
              {bulkOpen ? 'Cancel' : '+ Add Multiple'}
            </button>
            <button
              type="button"
              className={`${historyStyles.button} ${historyStyles.primary}`}
              onClick={() => router.push('/admin-expenses/new')}
            >
              + Add Expense
            </button>
          </div>
        </div>

        {bulkOpen && (
          <AdminExpenseBulkForm onClose={() => setBulkOpen(false)} onSaved={() => fetchEntries()} />
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
                  <th className={styles.colAdded}>Status</th>
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
                      {entry.approval_status === 'pending_approval' ? (
                        <span className={styles.typeBadge} style={{ background: '#fee2e2', color: '#991b1b' }}>Pending Approval</span>
                      ) : (
                        <span className={styles.typeBadge} style={{ background: '#dcfce7', color: '#166534' }} title={entry.approved_by_name ? `Approved by ${entry.approved_by_name}` : undefined}>
                          Approved
                        </span>
                      )}
                    </td>
                    <td>
                      <div className={styles.rowActions}>
                        {isApprover && entry.approval_status === 'pending_approval' && (
                          <button
                            type="button"
                            onClick={() => handleApprove(entry.batchId)}
                            disabled={approving === entry.batchId}
                            className={styles.editRowBtn}
                            style={{ opacity: approving === entry.batchId ? 0.5 : 1 }}
                          >
                            {approving === entry.batchId ? '…' : 'Approve'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => router.push(`/admin-expenses/${encodeURIComponent(entry.batchId)}/edit`)}
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
