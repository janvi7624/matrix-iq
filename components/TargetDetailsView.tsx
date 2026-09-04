'use client';

import { useEffect, useMemo, useState } from 'react';
import { Target as TargetIcon } from 'lucide-react';
import AppShell from './AppShell';
import StatTile from './ui/StatTile';
import Table from './ui/Table';
import StatusBadge, { StatusTone } from './ui/StatusBadge';
import ToolbarButton from './ui/ToolbarButton';
import ErrorState from './ui/ErrorState';
import EmptyState from './ui/EmptyState';
import { SkeletonRows } from './ui/Skeleton';
import { useToast } from './ui/ToastProvider';
import TargetDrilldownModal from './TargetDrilldownModal';
import TargetFormDialog from './TargetFormDialog';
import { currentFiscalYear, fiscalYearOptions, listPeriodOptions, periodContainingDate, TargetPeriodType } from '@/lib/targetPeriod';
import { formatMoney } from '@/lib/format';
import calcStyles from './calculator.module.css';
import historyStyles from './quotationHistory.module.css';
import styles from './targetDetails.module.css';

const PERIOD_TYPE_LABEL: Record<TargetPeriodType, string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  half_yearly: 'Half-Yearly',
  annual: 'Annual'
};

const TARGET_STATUS_LABEL: Record<string, string> = {
  not_started: 'Not Started',
  on_track: 'On Track',
  at_risk: 'At Risk',
  achieved: 'Achieved',
  exceeded: 'Exceeded'
};

interface EmployeeRow {
  employeeId: string;
  username: string;
  name: string;
  designation: string;
  targetId: string | null;
  targetAmount: number;
  achievedAmount: number;
  achievementPercent: number;
  status: string;
  updatedAt: string;
}

interface TargetsPayload {
  periodType: TargetPeriodType;
  fiscalYear: string;
  periodKey: string;
  periodStart: string;
  periodEnd: string;
  displayPeriod: string;
  summary: {
    totalTarget: number;
    totalAchieved: number;
    achievementPercent: number;
    employeeCount: number;
    exceededCount: number;
    achievedCount: number;
    onTrackCount: number;
    atRiskCount: number;
    notStartedCount: number;
  };
  employees: EmployeeRow[];
}

interface WeeklyQuotation {
  id: string;
  quotationNumber: string;
  clientName: string;
  status: string;
  total: number;
  project: { id: string; label: string; stage: string; status: string } | null;
}

export default function TargetDetailsView() {
  const toast = useToast();
  const [tab, setTab] = useState<'overview' | 'weekly'>('overview');

  const [periodType, setPeriodType] = useState<TargetPeriodType>('monthly');
  const [fiscalYear, setFiscalYear] = useState(currentFiscalYear());
  const [periodKey, setPeriodKey] = useState(() => periodContainingDate('monthly').periodKey);

  const [data, setData] = useState<TargetsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [drilldown, setDrilldown] = useState<{ employeeId: string; name: string } | null>(null);
  const [formTarget, setFormTarget] = useState<{ employeeId: string; name: string; existing: EmployeeRow | null } | null>(null);

  const periodOptions = useMemo(() => listPeriodOptions(periodType, fiscalYear), [periodType, fiscalYear]);

  // Switching period type resets to "the period containing today" rather
  // than leaving a stale key from the previous type around.
  function handlePeriodTypeChange(next: TargetPeriodType) {
    setPeriodType(next);
    setPeriodKey(periodContainingDate(next).periodKey);
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadFailed(false);
    const params = new URLSearchParams({ periodType, fiscalYear, periodKey });
    fetch(`/api/targets?${params.toString()}`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((json: TargetsPayload) => {
        if (!cancelled) setData(json);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [periodType, fiscalYear, periodKey, reloadKey]);

  const load = () => setReloadKey((k) => k + 1);

  return (
    <AppShell title="Target Details" subtitle="Sales Team targets vs achievement, by period.">
      <div className={styles.tabRow}>
        <button type="button" className={tab === 'overview' ? styles.tabActive : styles.tab} onClick={() => setTab('overview')}>Overview</button>
        <button type="button" className={tab === 'weekly' ? styles.tabActive : styles.tab} onClick={() => setTab('weekly')}>Weekly Update</button>
      </div>

      <div className={historyStyles.toolbar}>
        <select className={calcStyles.formControl} value={periodType} onChange={(e) => handlePeriodTypeChange(e.target.value as TargetPeriodType)} aria-label="Target Period">
          {(Object.keys(PERIOD_TYPE_LABEL) as TargetPeriodType[]).map((pt) => (
            <option key={pt} value={pt}>{PERIOD_TYPE_LABEL[pt]}</option>
          ))}
        </select>
        <select className={calcStyles.formControl} value={fiscalYear} onChange={(e) => setFiscalYear(e.target.value)} aria-label="Fiscal Year">
          {fiscalYearOptions().map((fy) => (
            <option key={fy} value={fy}>FY {fy}</option>
          ))}
        </select>
        {periodType !== 'annual' && (
          <select className={calcStyles.formControl} value={periodKey} onChange={(e) => setPeriodKey(e.target.value)} aria-label="Period">
            {periodOptions.map((p) => (
              <option key={p.key} value={p.key}>{p.label}</option>
            ))}
          </select>
        )}
        <ToolbarButton onClick={load}>Refresh</ToolbarButton>
      </div>

      {loading ? (
        <SkeletonRows rows={6} columns={4} />
      ) : loadFailed ? (
        <ErrorState message="Could not load Target Details — check your connection and try again." onRetry={load} />
      ) : !data ? null : tab === 'overview' ? (
        <OverviewTab
          data={data}
          onOpenDrilldown={(employeeId, name) => setDrilldown({ employeeId, name })}
          onOpenForm={(row) => setFormTarget({ employeeId: row.employeeId, name: row.name, existing: row.targetId ? row : null })}
        />
      ) : (
        <WeeklyUpdateTab data={data} periodType={periodType} fiscalYear={fiscalYear} periodKey={periodKey} toast={toast} onChanged={load} />
      )}

      {drilldown && (
        <TargetDrilldownModal
          employeeId={drilldown.employeeId}
          employeeName={drilldown.name}
          periodType={periodType}
          fiscalYear={fiscalYear}
          periodKey={periodKey}
          onClose={() => setDrilldown(null)}
        />
      )}

      {formTarget && (
        <TargetFormDialog
          employeeId={formTarget.employeeId}
          employeeName={formTarget.name}
          existingTarget={
            formTarget.existing
              ? { id: formTarget.existing.targetId as string, periodType, displayPeriod: data?.displayPeriod ?? '', targetAmount: formTarget.existing.targetAmount, notes: '' }
              : null
          }
          defaultPeriodType={periodType}
          defaultFiscalYear={fiscalYear}
          defaultPeriodKey={periodKey}
          onClose={() => setFormTarget(null)}
          onSaved={() => {
            setFormTarget(null);
            load();
          }}
        />
      )}
    </AppShell>
  );
}

function OverviewTab({
  data,
  onOpenDrilldown,
  onOpenForm
}: {
  data: TargetsPayload;
  onOpenDrilldown: (employeeId: string, name: string) => void;
  onOpenForm: (row: EmployeeRow) => void;
}) {
  const { summary } = data;
  return (
    <>
      <div className={styles.statsRow}>
        <StatTile value={formatMoney(summary.totalTarget)} label="Total Sales Target" />
        <StatTile value={formatMoney(summary.totalAchieved)} label="Total Achievement" tone="success" />
        <StatTile value={`${summary.achievementPercent}%`} label="Achievement %" tone="info" />
        <StatTile value={formatMoney(Math.max(0, summary.totalTarget - summary.totalAchieved))} label="Remaining Target" tone="warning" />
        <StatTile value={summary.employeeCount} label="Sales Employees" />
        <StatTile value={summary.achievedCount + summary.exceededCount} label="Employees Achieved" tone="success" />
        <StatTile value={summary.atRiskCount} label="Employees At Risk" tone="danger" />
      </div>

      {data.employees.length === 0 ? (
        <EmptyState icon={TargetIcon} title="No Sales Team employees found" message="Add employees to the Sales or GEM - Sales department to manage their targets here." />
      ) : (
        <Table
          columns={[
            {
              key: 'employee',
              header: 'Employee',
              render: (row: EmployeeRow) => (
                <button type="button" className={historyStyles.toggleBtn} onClick={() => onOpenDrilldown(row.employeeId, row.name)}>
                  {row.name}
                </button>
              )
            },
            { key: 'target', header: 'Target', render: (row: EmployeeRow) => (row.targetId ? formatMoney(row.targetAmount) : '—') },
            { key: 'achievement', header: 'Achievement', render: (row: EmployeeRow) => formatMoney(row.achievedAmount) },
            { key: 'achievementPercent', header: 'Achievement %', render: (row: EmployeeRow) => (row.targetId ? `${row.achievementPercent}%` : '—') },
            { key: 'remaining', header: 'Remaining', render: (row: EmployeeRow) => (row.targetId ? formatMoney(Math.max(0, row.targetAmount - row.achievedAmount)) : '—') },
            {
              key: 'status',
              header: 'Status',
              render: (row: EmployeeRow) => (
                <StatusBadge tone={row.status === 'achieved' ? 'won' : (row.status as StatusTone)} label={TARGET_STATUS_LABEL[row.status] || row.status} />
              )
            },
            { key: 'updatedAt', header: 'Last Updated', render: (row: EmployeeRow) => (row.updatedAt ? new Date(row.updatedAt).toLocaleDateString('en-IN') : '—') },
            {
              key: 'actions',
              header: '',
              render: (row: EmployeeRow) => (
                <button type="button" className={historyStyles.toggleBtn} onClick={() => onOpenForm(row)}>
                  {row.targetId ? 'Edit' : 'Set Target'}
                </button>
              )
            }
          ]}
          rows={data.employees}
          rowKey={(row) => row.employeeId}
        />
      )}
    </>
  );
}

function WeeklyUpdateTab({
  data,
  periodType,
  fiscalYear,
  periodKey,
  toast,
  onChanged
}: {
  data: TargetsPayload;
  periodType: TargetPeriodType;
  fiscalYear: string;
  periodKey: string;
  toast: ReturnType<typeof useToast>;
  onChanged: () => void;
}) {
  const [employeeId, setEmployeeId] = useState(data.employees[0]?.employeeId ?? '');
  const [quotations, setQuotations] = useState<WeeklyQuotation[] | null>(null);
  const [notes, setNotes] = useState('');
  const [targetId, setTargetId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!employeeId) {
      setQuotations([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ employeeId, periodType, fiscalYear, periodKey });
    fetch(`/api/targets/weekly-update?${params.toString()}`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((json: { target: { id: string | null; notes: string }; quotations: WeeklyQuotation[] }) => {
        if (cancelled) return;
        setQuotations(json.quotations);
        setNotes(json.target.notes || '');
        setTargetId(json.target.id);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load this employee’s quotations for the selected period.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [employeeId, periodType, fiscalYear, periodKey]);

  async function flipStatus(quotationId: string, status: string) {
    setBusyId(quotationId);
    try {
      const response = await fetch('/api/targets/weekly-update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'quotation_status', quotationId, status, periodType, fiscalYear, periodKey })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast.error(body.error || 'Could not update this quotation’s status.');
        return;
      }
      setQuotations(body.quotations);
      toast.success('Quotation status updated.');
      onChanged();
    } catch {
      toast.error('Could not reach the server. Please try again.');
    } finally {
      setBusyId(null);
    }
  }

  async function saveNotes() {
    if (!targetId) {
      toast.error('Set a target for this employee and period before adding notes.');
      return;
    }
    try {
      const response = await fetch('/api/targets/weekly-update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'notes', targetId, notes })
      });
      if (!response.ok) throw new Error();
      toast.success('Notes saved.');
    } catch {
      toast.error('Could not save notes. Please try again.');
    }
  }

  return (
    <>
      <div className={historyStyles.toolbar}>
        <select className={calcStyles.formControl} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} aria-label="Employee">
          {data.employees.map((e) => (
            <option key={e.employeeId} value={e.employeeId}>{e.name}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <SkeletonRows rows={4} columns={4} />
      ) : error ? (
        <ErrorState message={error} />
      ) : (
        <>
          <Table
            columns={[
              { key: 'quotationNumber', header: 'Billing / Quotation Ref', render: (q: WeeklyQuotation) => q.quotationNumber },
              { key: 'clientProject', header: 'Client / Project', render: (q: WeeklyQuotation) => q.project?.label || q.clientName || '—' },
              { key: 'total', header: 'Amount', render: (q: WeeklyQuotation) => formatMoney(q.total) },
              {
                key: 'status',
                header: 'Sales Status',
                render: (q: WeeklyQuotation) => (
                  <select
                    className={calcStyles.formControl}
                    value={q.status}
                    disabled={busyId === q.id}
                    onChange={(e) => flipStatus(q.id, e.target.value)}
                  >
                    <option value="draft">Draft</option>
                    <option value="sent">Sent</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                  </select>
                )
              }
            ]}
            rows={quotations ?? []}
            rowKey={(q) => q.id}
            empty="No quotations recorded for this employee in the selected period."
          />

          <div className={calcStyles.field} style={{ marginTop: 16 }}>
            <label>Notes for this period</label>
            <textarea className={calcStyles.formControl} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Following up with Acme Corp on Thursday" />
            <ToolbarButton onClick={saveNotes}>Save Notes</ToolbarButton>
          </div>
        </>
      )}
    </>
  );
}
