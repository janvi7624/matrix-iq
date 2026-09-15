'use client';

import { useCallback, useEffect, useState } from 'react';
import AppShell from './AppShell';
import { useToast } from './ui/ToastProvider';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';

interface ReportRow {
  batchId: string;
  date: string;
  monthLabel: string;
  employeeId: string;
  employeeName: string;
  description: string;
  fromLocation: string;
  toLocation: string;
  amount: number;
}

interface EmployeeSummary {
  employeeId: string;
  employeeName: string;
  expenseCount: number;
  totalAmount: number;
}

interface ReportData {
  month: string;
  monthLabel: string;
  rows: ReportRow[];
  totalExpenses: number;
  totalAmount: number;
  employeeSummary: EmployeeSummary[];
}

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function formatCurrency(n: number): string {
  return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function AdminExpenseReportView() {
  const toast = useToast();
  const [month, setMonth] = useState(currentMonthKey());
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const fetchReport = useCallback(async (m: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin-expense-report?month=${encodeURIComponent(m)}`);
      const json = await res.json();
      if (res.ok) {
        setData(json);
      } else {
        toast.error(json.error || 'Failed to load report');
        setData(null);
      }
    } catch {
      toast.error('Network error');
      setData(null);
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchReport(month);
  }, [month, fetchReport]);

  async function handleExport() {
    setExporting(true);
    try {
      const res = await fetch(`/api/admin-expense-report/export?month=${encodeURIComponent(month)}`);
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        toast.error(json?.error || 'Failed to export report');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Admin_Expense_Report_${data?.monthLabel || month}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Network error');
    } finally {
      setExporting(false);
    }
  }

  return (
    <AppShell title="Admin Expense Report" subtitle="Company-paid admin expenses by employee, by month">
      <div className={historyStyles.headerRow}>
        <div className={calcStyles.field} style={{ maxWidth: 220 }}>
          <label className={calcStyles.label}>Month</label>
          <input
            type="month"
            className={calcStyles.formControl}
            value={month}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
          />
        </div>
        <button
          type="button"
          className={`${historyStyles.button} ${historyStyles.primary}`}
          onClick={handleExport}
          disabled={exporting || loading}
        >
          {exporting ? 'Exporting…' : 'Download Excel'}
        </button>
      </div>

      {loading ? (
        <div className={historyStyles.status}>Loading…</div>
      ) : !data ? (
        <div className={historyStyles.status}>Could not load report.</div>
      ) : (
        <>
          <div className={historyStyles.summaryCardGrid}>
            <div className={historyStyles.summaryCard}>
              <div className={historyStyles.summaryCardLabel}>Total Expenses</div>
              <div className={historyStyles.summaryCardValue}>{data.totalExpenses}</div>
            </div>
            <div className={historyStyles.summaryCard}>
              <div className={historyStyles.summaryCardLabel}>Total Amount</div>
              <div className={historyStyles.summaryCardValue}>{formatCurrency(data.totalAmount)}</div>
            </div>
          </div>

          {data.employeeSummary.length > 0 && (
            <>
              <h2 className={calcStyles.h2}>Employee-wise Summary</h2>
              <div className={historyStyles.tableWrap}>
                <table className={historyStyles.table}>
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Expense Count</th>
                      <th>Total Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.employeeSummary.map((e) => (
                      <tr key={e.employeeId}>
                        <td>{e.employeeName}</td>
                        <td>{e.expenseCount}</td>
                        <td>{formatCurrency(e.totalAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <h2 className={calcStyles.h2}>Expenses</h2>
          {data.rows.length === 0 ? (
            <div className={historyStyles.status}>No admin expenses found for {data.monthLabel}.</div>
          ) : (
            <div className={historyStyles.tableWrap}>
              <table className={historyStyles.table}>
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Name</th>
                    <th>Description</th>
                    <th>From</th>
                    <th>To</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r, i) => (
                    <tr key={`${r.batchId}-${r.employeeId}-${i}`}>
                      <td>{r.monthLabel}</td>
                      <td>{r.employeeName}</td>
                      <td>{r.description}</td>
                      <td>{r.fromLocation || '-'}</td>
                      <td>{r.toLocation || '-'}</td>
                      <td>{formatCurrency(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}
