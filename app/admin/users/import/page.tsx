'use client';

import { ChangeEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { BRAND } from '@/lib/branding';
import historyStyles from '@/components/quotationHistory.module.css';
import calcStyles from '@/components/calculator.module.css';
import { useToast } from '@/components/ui/ToastProvider';

interface ImportResultRow {
  rowNumber: number;
  name: string;
  employeeId: string;
  department: string;
  designation: string;
  location: string;
  email: string;
  phone: string;
  status: 'created' | 'existing' | 'needsReview' | 'error' | 'skipped';
  reason: string;
  username: string;
  role: string;
  tempPassword?: string;
  matchedExistingUsername?: string;
}

interface ImportSummary {
  total: number;
  created: number;
  existing: number;
  needsReview: number;
  errors: number;
  skipped: number;
  departmentsCreated: string[];
}

interface ImportRunResult {
  summary: ImportSummary;
  rows: ImportResultRow[];
}

const STATUS_LABEL: Record<ImportResultRow['status'], string> = {
  created: 'Created',
  existing: 'Already Existing',
  needsReview: 'Requires Review',
  error: 'Error',
  skipped: 'Skipped'
};

const STATUS_CLASS: Record<ImportResultRow['status'], string> = {
  created: historyStyles.statusPillActive,
  existing: historyStyles.rolePillBackoffice,
  needsReview: historyStyles.followUpBadge,
  error: historyStyles.statusPillInactive,
  skipped: historyStyles.rolePillUser
};

function ResultRow({ row }: { row: ImportResultRow }) {
  return (
    <tr>
      <td>{row.rowNumber}</td>
      <td>{row.name || '-'}</td>
      <td>{row.employeeId || '-'}</td>
      <td>{row.department || '-'}</td>
      <td>{row.username || '-'}</td>
      <td><span className={`${historyStyles.statusPill} ${STATUS_CLASS[row.status]}`}>{STATUS_LABEL[row.status]}</span></td>
      <td style={{ fontSize: 12.5, color: '#6b7280' }}>{row.reason || '-'}</td>
    </tr>
  );
}

function SummaryBar({ summary }: { summary: ImportSummary }) {
  const items: { label: string; value: number }[] = [
    { label: 'Total Rows', value: summary.total },
    { label: 'Successfully Created', value: summary.created },
    { label: 'Already Existing', value: summary.existing },
    { label: 'Requires Review', value: summary.needsReview },
    { label: 'Errors', value: summary.errors },
    { label: 'Skipped', value: summary.skipped }
  ];
  return (
    <div className={historyStyles.summaryCardGrid}>
      {items.map((item) => (
        <div key={item.label} className={historyStyles.summaryCard}>
          <div className={historyStyles.summaryCardLabel}>{item.label}</div>
          <div className={historyStyles.summaryCardValue}>{item.value}</div>
        </div>
      ))}
    </div>
  );
}

export default function ImportEmployeesPage() {
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [currentRole, setCurrentRole] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<'idle' | 'previewing' | 'preview' | 'committing' | 'done'>('idle');
  const [preview, setPreview] = useState<ImportRunResult | null>(null);
  const [committed, setCommitted] = useState<ImportRunResult | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => setCurrentRole(me?.role || null))
      .catch(() => setCurrentRole(null));
  }, []);

  const authorized = currentRole === 'admin' || currentRole === 'superadmin';

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0] || null;
    setFile(picked);
    setPreview(null);
    setCommitted(null);
    setStage('idle');
  }

  async function runPreview() {
    if (!file) return;
    setStage('previewing');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch('/api/admin/users/import/preview', { method: 'POST', body: formData });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        toast.error(body?.error || 'Could not read this file.');
        setStage('idle');
        return;
      }
      const data: ImportRunResult = await response.json();
      setPreview(data);
      setStage('preview');
    } catch {
      toast.error('Could not reach the server.');
      setStage('idle');
    }
  }

  async function runCommit() {
    if (!file) return;
    setStage('committing');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch('/api/admin/users/import/commit', { method: 'POST', body: formData });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        toast.error(body?.error || 'Import failed.');
        setStage('preview');
        return;
      }
      const data: ImportRunResult = await response.json();
      setCommitted(data);
      setStage('done');
      toast.success(`Import complete — ${data.summary.created} account${data.summary.created === 1 ? '' : 's'} created.`);
    } catch {
      toast.error('Could not reach the server.');
      setStage('preview');
    }
  }

  async function exportCredentials() {
    if (!committed) return;
    const credentialRows = committed.rows
      .filter((r) => r.status === 'created' || r.status === 'needsReview')
      .map((r) => ({
        name: r.name,
        employeeId: r.employeeId,
        username: r.username,
        tempPassword: r.tempPassword || '',
        role: r.role,
        department: r.department,
        status: 'active'
      }));
    if (!credentialRows.length) {
      toast.info('No new accounts to export.');
      return;
    }
    setExporting(true);
    try {
      const response = await fetch('/api/admin/users/import/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: credentialRows })
      });
      if (!response.ok) {
        toast.error('Could not export credentials.');
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'user-credentials.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  function reset() {
    setFile(null);
    setPreview(null);
    setCommitted(null);
    setStage('idle');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const activeResult = stage === 'done' ? committed : preview;
  const createdRows = committed?.rows.filter((r) => (r.status === 'created' || r.status === 'needsReview') && r.tempPassword) || [];

  return (
    <div className={historyStyles.body}>
      <header className={historyStyles.header}>
        <Link href="/admin/users" className={historyStyles.headerBrand} style={{ textDecoration: 'none', color: 'inherit' }}>
          <Image src="/NANTA.png" alt={`${BRAND.companyName} logo`} width={38} height={38} className={historyStyles.headerLogo} unoptimized />
          <div>
            <h1>{BRAND.appName} — Import Employees</h1>
            <div className={historyStyles.sub}>Administration &rsaquo; User Management &rsaquo; bulk-create accounts from Excel.</div>
          </div>
        </Link>
        <div style={{ display: 'flex', gap: 10 }}>
          <Link className={historyStyles.button} href="/admin/users">Back to User Management</Link>
        </div>
      </header>
      <main className={historyStyles.main}>
        {currentRole !== null && !authorized ? (
          <div className={calcStyles.sectionPanel}>
            <p>Bulk employee import is available to Admin and Super Admin accounts only.</p>
          </div>
        ) : (
          <>
            <div className={calcStyles.sectionPanel}>
              <h2 className={calcStyles.h2} style={{ marginTop: 0 }}>1. Choose file</h2>
              <p className={calcStyles.small}>
                Upload an .xlsx file with employee columns (e.g. Emp. ID, Emp. Name, Department, Designation, Location, E-mail, Phone Number).
                Nothing is created yet — the next step previews exactly what would happen.
              </p>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <input ref={fileInputRef} type="file" accept=".xlsx" onChange={handleFileChange} />
                <button type="button" className={calcStyles.btn} disabled={!file || stage === 'previewing'} onClick={runPreview}>
                  {stage === 'previewing' ? 'Reading file...' : 'Preview Import'}
                </button>
                {(preview || committed) && (
                  <button type="button" className={historyStyles.button} onClick={reset}>Start Over</button>
                )}
              </div>
            </div>

            {activeResult && (
              <>
                <h2 className={calcStyles.h2}>{stage === 'done' ? '2. Import Summary' : '2. Preview — nothing has been created yet'}</h2>
                <SummaryBar summary={activeResult.summary} />
                {activeResult.summary.departmentsCreated.length > 0 && (
                  <p className={calcStyles.small}>
                    {stage === 'done' ? 'New departments created: ' : 'New departments that will be created: '}
                    {activeResult.summary.departmentsCreated.join(', ')}
                  </p>
                )}

                <div className={historyStyles.tableWrap}>
                  <table className={historyStyles.table}>
                    <thead>
                      <tr>
                        <th>Row</th>
                        <th>Name</th>
                        <th>Employee ID</th>
                        <th>Department</th>
                        <th>Username</th>
                        <th>Status</th>
                        <th>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeResult.rows.map((row) => <ResultRow key={row.rowNumber} row={row} />)}
                    </tbody>
                  </table>
                </div>

                {stage === 'preview' && (
                  <div style={{ marginTop: 14 }}>
                    <button type="button" className={calcStyles.btn} onClick={runCommit}>
                      Confirm Import — Create {preview?.summary.created ?? 0} Account{(preview?.summary.created ?? 0) === 1 ? '' : 's'}
                    </button>
                  </div>
                )}
                {stage === 'committing' && <div className={historyStyles.status}>Creating accounts...</div>}

                {stage === 'done' && createdRows.length > 0 && (
                  <>
                    <h2 className={calcStyles.h2}>3. User Credentials — visible only right now</h2>
                    <p className={calcStyles.small}>
                      These temporary passwords are shown only on this results screen and are never stored in plain text or shown again after you leave this page.
                      Export or share them securely, then ask each employee to change their password on first login.
                    </p>
                    <div style={{ marginBottom: 10 }}>
                      <button type="button" className={calcStyles.btn} onClick={exportCredentials} disabled={exporting}>
                        {exporting ? 'Exporting...' : 'Export User Credentials (Excel)'}
                      </button>
                    </div>
                    <div className={historyStyles.tableWrap}>
                      <table className={historyStyles.table}>
                        <thead>
                          <tr>
                            <th>Employee</th>
                            <th>Employee ID</th>
                            <th>Username</th>
                            <th>Temporary Password</th>
                            <th>Role</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {createdRows.map((row) => (
                            <tr key={row.rowNumber}>
                              <td>{row.name}</td>
                              <td>{row.employeeId || '-'}</td>
                              <td className={historyStyles.num}>{row.username}</td>
                              <td className={historyStyles.num}>{row.tempPassword}</td>
                              <td>{row.role}</td>
                              <td><span className={`${historyStyles.statusPill} ${historyStyles.statusPillActive}`}>Active</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
