'use client';

import { useEffect, useState } from 'react';
import Modal, { ModalOkButton } from './ui/Modal';
import StatusBadge, { StatusTone } from './ui/StatusBadge';
import ErrorState from './ui/ErrorState';
import { SkeletonRows } from './ui/Skeleton';
import Table from './ui/Table';
import { formatMoney } from '@/lib/format';
import { TargetPeriodType } from '@/lib/targetPeriod';
import styles from './departmentHealthDetail.module.css';

const TARGET_STATUS_LABEL: Record<string, string> = {
  not_started: 'Not Started',
  on_track: 'On Track',
  at_risk: 'At Risk',
  achieved: 'Achieved',
  exceeded: 'Exceeded'
};

interface QualifyingQuotation {
  id: string;
  quotationNumber: string;
  clientName: string;
  total: number;
  createdAt: string;
  projectId: string;
}

interface DrilldownPayload {
  employee: { id: string; username: string; name: string; department: string; designation: string };
  target: { id: string | null; periodType: TargetPeriodType; displayPeriod: string; targetAmount: number; notes: string };
  achievedAmount: number;
  achievementPercent: number;
  status: string;
  qualifyingQuotations: QualifyingQuotation[];
}

interface TargetDrilldownModalProps {
  employeeId: string;
  employeeName: string;
  periodType: TargetPeriodType;
  fiscalYear: string;
  periodKey: string;
  onClose: () => void;
}

export default function TargetDrilldownModal({ employeeId, employeeName, periodType, fiscalYear, periodKey, onClose }: TargetDrilldownModalProps) {
  const [data, setData] = useState<DrilldownPayload | null>(null);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError('');
    const params = new URLSearchParams({ periodType, fiscalYear, periodKey });
    fetch(`/api/targets/employee/${encodeURIComponent(employeeId)}/drilldown?${params.toString()}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 403 ? 'You do not have access to this employee’s target data.' : `Server responded with ${r.status}`);
        return r.json();
      })
      .then((json: DrilldownPayload) => {
        if (!cancelled) setData(json);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message || 'Could not load this employee’s target dashboard.');
      });
    return () => {
      cancelled = true;
    };
  }, [employeeId, periodType, fiscalYear, periodKey, reloadKey]);

  const remaining = data ? Math.max(0, data.target.targetAmount - data.achievedAmount) : 0;

  return (
    <Modal
      title={
        <>
          {employeeName}
          <div className={styles.personSubtitle}>{data ? [data.employee.department, data.employee.designation].filter(Boolean).join(' · ') : ''}</div>
        </>
      }
      ariaLabel={`Target dashboard for ${employeeName}`}
      onClose={onClose}
      size="full"
      footer={<ModalOkButton onClick={onClose}>Close</ModalOkButton>}
    >
      {error ? (
        <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
      ) : !data ? (
        <div className={styles.loadingWrap}><SkeletonRows rows={5} columns={3} /></div>
      ) : (
        <>
          <h3 className={styles.sectionTitle}>Employee Target Dashboard — {data.target.displayPeriod}</h3>
          <div className={styles.totalsGrid}>
            <div className={styles.totalCard}>
              <div className={styles.totalValue}>{formatMoney(data.target.targetAmount)}</div>
              <div className={styles.totalLabel}>Target</div>
            </div>
            <div className={styles.totalCard}>
              <div className={styles.totalValue}>{formatMoney(data.achievedAmount)}</div>
              <div className={styles.totalLabel}>Achievement</div>
            </div>
            <div className={styles.totalCard}>
              <div className={styles.totalValue}>{data.achievementPercent}%</div>
              <div className={styles.totalLabel}>Achievement %</div>
            </div>
            <div className={styles.totalCard}>
              <div className={styles.totalValue}>{formatMoney(remaining)}</div>
              <div className={styles.totalLabel}>Remaining</div>
            </div>
            <div className={styles.totalCard}>
              <StatusBadge tone={data.status === 'achieved' ? 'won' : (data.status as StatusTone)} label={TARGET_STATUS_LABEL[data.status] || data.status} />
              <div className={styles.totalLabel}>Status</div>
            </div>
          </div>

          <h3 className={styles.sectionTitle}>Qualifying sales records ({data.qualifyingQuotations.length})</h3>
          <Table
            columns={[
              { key: 'quotationNumber', header: 'Billing / Quotation Ref', render: (q: QualifyingQuotation) => q.quotationNumber },
              { key: 'clientName', header: 'Client / Project', render: (q: QualifyingQuotation) => q.clientName || '—' },
              { key: 'total', header: 'Amount', render: (q: QualifyingQuotation) => formatMoney(q.total) },
              { key: 'status', header: 'Won/Closed', render: () => <StatusBadge tone="won" label="Won" /> },
              { key: 'createdAt', header: 'Date', render: (q: QualifyingQuotation) => new Date(q.createdAt).toLocaleDateString('en-IN') }
            ]}
            rows={data.qualifyingQuotations}
            rowKey={(q) => q.id}
            empty="No qualifying sales records for this period yet."
          />
        </>
      )}
    </Modal>
  );
}
