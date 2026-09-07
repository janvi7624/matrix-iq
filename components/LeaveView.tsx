'use client';

import { FormEvent, useEffect, useState } from 'react';
import { CalendarOff } from 'lucide-react';
import { LeaveRequestRecord, LeaveType } from '@/lib/types';
import AppShell from './AppShell';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import { useToast } from './ui/ToastProvider';
import { SkeletonRows } from './ui/Skeleton';
import EmptyState from './ui/EmptyState';
import ErrorState from './ui/ErrorState';
import { Field, FieldRow } from './ui/Field';
import Input from './ui/Input';
import Select from './ui/Select';
import Textarea from './ui/Textarea';
import SubmitButton from './ui/SubmitButton';
import StatusBadge from './ui/StatusBadge';

const LEAVE_TYPE_LABEL: Record<LeaveType, string> = { casual: 'Casual', sick: 'Sick', earned: 'Earned', unpaid: 'Unpaid', other: 'Other' };
const STATUS_TONE = { pending: 'pending', approved: 'done', rejected: 'rejected', cancelled: 'cancelled' } as const;

function formatDate(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleDateString('en-IN');
  } catch {
    return iso;
  }
}

const EMPTY_FORM = { leaveType: 'casual' as LeaveType, startDate: '', endDate: '', reason: '' };

interface LeaveViewProps {
  currentUser: { username: string; name: string };
}

export default function LeaveView({ currentUser }: LeaveViewProps) {
  void currentUser;
  const toast = useToast();
  const [mine, setMine] = useState<LeaveRequestRecord[]>([]);
  const [teamPending, setTeamPending] = useState<LeaveRequestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [applying, setApplying] = useState(false);

  async function load() {
    setLoading(true);
    setLoadFailed(false);
    try {
      const response = await fetch('/api/leave');
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json();
      setMine(data.mine || []);
      setTeamPending(data.teamPending || []);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleApply(e: FormEvent) {
    e.preventDefault();
    if (!form.startDate || !form.endDate) return toast.error('Start and end dates are required.');
    setApplying(true);
    try {
      const response = await fetch('/api/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || String(response.status));
      }
      setForm(EMPTY_FORM);
      await load();
      toast.success('Leave request submitted.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not submit leave request.');
    } finally {
      setApplying(false);
    }
  }

  async function decide(id: string, action: 'approve' | 'reject') {
    try {
      const response = await fetch(`/api/leave/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
      if (!response.ok) throw new Error(String(response.status));
      await load();
      toast.success(`Leave ${action === 'approve' ? 'approved' : 'rejected'}.`);
    } catch {
      toast.error('Could not record this decision.');
    }
  }

  async function cancelRequest(id: string) {
    try {
      const response = await fetch(`/api/leave/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' })
      });
      if (!response.ok) throw new Error(String(response.status));
      await load();
      toast.success('Leave request cancelled.');
    } catch {
      toast.error('Could not cancel this request.');
    }
  }

  if (loading) {
    return (
      <AppShell title="Leave" subtitle="Apply for leave and track your requests.">
        <div className={historyStyles.tableWrap}><SkeletonRows rows={5} columns={5} /></div>
      </AppShell>
    );
  }
  if (loadFailed) {
    return (
      <AppShell title="Leave" subtitle="Apply for leave and track your requests.">
        <ErrorState message="Could not load leave requests — check your connection and try again." onRetry={load} />
      </AppShell>
    );
  }

  return (
    <AppShell title="Leave" subtitle="Apply for leave and track your requests.">
      <form className={`${calcStyles.sectionPanel} ${calcStyles.sectionPanelSpaced}`} onSubmit={handleApply}>
        <FieldRow>
          <Field label="Leave Type">
            <Select value={form.leaveType} onChange={(e) => setForm((f) => ({ ...f, leaveType: e.target.value as LeaveType }))}>
              {(Object.keys(LEAVE_TYPE_LABEL) as LeaveType[]).map((t) => (
                <option key={t} value={t}>{LEAVE_TYPE_LABEL[t]}</option>
              ))}
            </Select>
          </Field>
          <Field label="Start Date">
            <Input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} required />
          </Field>
          <Field label="End Date">
            <Input type="date" min={form.startDate} value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} required />
          </Field>
        </FieldRow>
        <Field label="Reason">
          <Textarea rows={2} value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} />
        </Field>
        <SubmitButton disabled={applying}>{applying ? 'Submitting…' : 'Apply for Leave'}</SubmitButton>
      </form>

      {teamPending.length > 0 && (
        <>
          <div className={`${calcStyles.h2}`}>Team Requests Awaiting Your Decision</div>
          <div className={historyStyles.tableWrap}>
            <table className={historyStyles.table}>
              <thead><tr><th>Employee</th><th>Type</th><th>Dates</th><th>Days</th><th>Reason</th><th></th></tr></thead>
              <tbody>
                {teamPending.map((r) => (
                  <tr key={r.id}>
                    <td>{r.user_name}</td>
                    <td>{LEAVE_TYPE_LABEL[r.leave_type]}</td>
                    <td>{formatDate(r.start_date)} - {formatDate(r.end_date)}</td>
                    <td>{r.days}</td>
                    <td>{r.reason || '-'}</td>
                    <td>
                      <button type="button" className={historyStyles.button} onClick={() => decide(r.id, 'approve')}>Approve</button>{' '}
                      <button type="button" className={historyStyles.button} onClick={() => decide(r.id, 'reject')}>Reject</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className={`${calcStyles.h2}`}>My Requests</div>
      {mine.length === 0 ? (
        <EmptyState icon={CalendarOff} title="No leave requests" message="Requests you submit will appear here." />
      ) : (
        <div className={historyStyles.tableWrap}>
          <table className={historyStyles.table}>
            <thead><tr><th>Type</th><th>Dates</th><th>Days</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {mine.map((r) => (
                <tr key={r.id}>
                  <td>{LEAVE_TYPE_LABEL[r.leave_type]}</td>
                  <td>{formatDate(r.start_date)} - {formatDate(r.end_date)}</td>
                  <td>{r.days}</td>
                  <td><StatusBadge tone={STATUS_TONE[r.status]} label={r.status} /></td>
                  <td>{r.status === 'pending' && <button type="button" className={historyStyles.button} onClick={() => cancelRequest(r.id)}>Cancel</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
