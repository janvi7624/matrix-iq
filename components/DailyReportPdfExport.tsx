'use client';

import { useState } from 'react';
import { FileDown } from 'lucide-react';
import { istDate, monthStart } from '@/lib/dailyReportTime';
import Button from './ui/Button';
import Input from './ui/Input';
import Select from './ui/Select';
import Modal, { ModalCancelButton, ModalOkButton } from './ui/Modal';
import { useToast } from './ui/ToastProvider';

// "Download Reports PDF" — the full CONTENT of filed daily reports, rendered
// on the server by /api/daily-reports/export-pdf. That route decides what the
// viewer may export; this dialog only picks the period and, for a manager /
// HR / admin, narrows to one department or one employee.

export interface DailyReportPdfExportProps {
  /** 'mine' = own reports only; 'team' = everything the viewer can read. */
  mode: 'mine' | 'team';
  departments?: { id: string; name: string }[];
  employees?: { id: string; name: string }[];
  /** Pre-selected employee (e.g. from a row's action). */
  initialEmployeeId?: string;
  label?: string;
}

export default function DailyReportPdfExport({ mode, departments = [], employees = [], initialEmployeeId = '', label }: DailyReportPdfExportProps) {
  const toast = useToast();
  const today = istDate(new Date());
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(monthStart(today));
  const [to, setTo] = useState(today);
  const [departmentId, setDepartmentId] = useState('');
  const [employeeId, setEmployeeId] = useState(initialEmployeeId);
  const [busy, setBusy] = useState(false);

  async function download() {
    if (!from || !to || from > to) {
      toast.error('Pick a valid From / To range.');
      return;
    }
    const params = new URLSearchParams({ from, to });
    if (mode === 'mine') params.set('mine', '1');
    else if (employeeId) params.set('employeeId', employeeId);
    else if (departmentId) params.set('departmentId', departmentId);

    setBusy(true);
    try {
      const response = await fetch(`/api/daily-reports/export-pdf?${params}`, { credentials: 'same-origin' });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || `Export failed (${response.status}).`);
      }
      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition') || '';
      const filename = /filename="([^"]+)"/.exec(disposition)?.[1] || `daily-reports-${from}-to-${to}.pdf`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not export the PDF.');
    } finally {
      setBusy(false);
    }
  }

  const sortedEmployees = [...employees].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <Button variant="secondary" compact icon={<FileDown size={14} />} onClick={() => setOpen(true)}>
        {label ?? (mode === 'mine' ? 'My Reports PDF' : 'Reports PDF')}
      </Button>
      {open && (
        <Modal
          title={mode === 'mine' ? 'Download my daily reports' : 'Download daily reports'}
          ariaLabel="Download daily reports PDF"
          onClose={() => !busy && setOpen(false)}
          dismissible={!busy}
          footer={
            <>
              <ModalCancelButton onClick={() => setOpen(false)} disabled={busy}>Cancel</ModalCancelButton>
              <ModalOkButton onClick={download} disabled={busy}>{busy ? 'Preparing…' : 'Download PDF'}</ModalOkButton>
            </>
          }
        >
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
            <label style={{ display: 'grid', gap: 4 }}>
              <span>From</span>
              <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              <span>To</span>
              <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
            </label>
          </div>
          {mode === 'team' && (
            <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
              {departments.length > 1 && (
                <label style={{ display: 'grid', gap: 4 }}>
                  <span>Department</span>
                  <Select value={departmentId} disabled={!!employeeId} onChange={(e) => setDepartmentId(e.target.value)}>
                    <option value="">All departments I can see</option>
                    {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </Select>
                </label>
              )}
              {sortedEmployees.length > 0 && (
                <label style={{ display: 'grid', gap: 4 }}>
                  <span>Employee</span>
                  <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
                    <option value="">All employees</option>
                    {sortedEmployees.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </Select>
                </label>
              )}
            </div>
          )}
          <p style={{ marginTop: 12, fontSize: 13, opacity: 0.75 }}>
            Each employee gets their own section with every filed report in the period — header notes, task rows and counts. Drafts are not included. Up to one year per export.
          </p>
        </Modal>
      )}
    </>
  );
}
