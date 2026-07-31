'use client';

import { FormEvent, Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { DemoOutcome, DemoScheduleRecord, DomainKey, ProjectRecord, QuotationRecord, UserRole } from '@/lib/types';
import { TECHNICAL_TEAM } from '@/lib/teamMembers';
import { DOMAIN_DISPLAY_NAME } from '@/lib/domainLabels';
import { domainLeadLabel } from '@/lib/domainLeads';
import PortalHeader from './PortalHeader';
import TeamCheckboxes from './TeamCheckboxes';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';

const EMPTY_FORM = {
  projectId: '',
  quotationId: '',
  clientName: '',
  company: '',
  location: '',
  productDomain: '' as DomainKey | '',
  technicalMembers: [] as string[],
  scheduledAt: '',
  assignedRep: '',
  demoObjective: '',
  notes: ''
};

const EMPTY_REPORT_FORM = {
  outcome: '' as DemoOutcome,
  customerRating: 0,
  keyQueries: '',
  technicalChallenges: '',
  unansweredQueries: '',
  suggestedNextAction: '',
  nextFollowUpDate: '',
  attachments: [] as string[]
};

const STATUS_LABEL: Record<DemoScheduleRecord['status'], string> = {
  pending: 'Pending approval',
  confirmed: 'Confirmed',
  rejected: 'Rejected',
  done: 'Done',
  cancelled: 'Cancelled'
};

const STATUS_CLASS: Record<DemoScheduleRecord['status'], string> = {
  pending: historyStyles.statusPending,
  confirmed: historyStyles.statusConfirmed,
  rejected: historyStyles.statusRejected,
  done: historyStyles.statusDone,
  cancelled: historyStyles.statusCancelled
};

const OUTCOME_LABEL: Record<Exclude<DemoOutcome, ''>, string> = {
  successful: 'Successful',
  need_followup: 'Need Follow-up',
  pending_decision: 'Pending Decision',
  cancelled: 'Cancelled'
};

function formatDateTime(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('en-IN');
  } catch {
    return iso;
  }
}

function DemoReportRow({
  record,
  isPrivileged,
  currentUsername,
  onApprove,
  onReject,
  onCancel,
  onMarkDone,
  onDelete,
  onSaveReport
}: {
  record: DemoScheduleRecord;
  isPrivileged: boolean;
  currentUsername: string;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onCancel: (id: string) => void;
  onMarkDone: (id: string) => void;
  onDelete: (id: string) => void;
  onSaveReport: (id: string, patch: Record<string, unknown>) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [report, setReport] = useState({
    outcome: record.outcome,
    customerRating: record.customer_rating,
    keyQueries: record.key_queries,
    technicalChallenges: record.technical_challenges,
    unansweredQueries: record.unanswered_queries,
    suggestedNextAction: record.suggested_next_action,
    nextFollowUpDate: record.next_follow_up_date,
    attachments: record.attachments
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  async function handleUpload(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    try {
      const body = new FormData();
      body.append('folder', 'demo');
      Array.from(fileList).forEach((f) => body.append('files', f));
      const response = await fetch('/api/uploads', { method: 'POST', body });
      if (!response.ok) throw new Error(String(response.status));
      const data: { urls: string[] } = await response.json();
      setReport((r) => ({ ...r, attachments: [...r.attachments, ...data.urls] }));
    } catch {
      alert('Could not upload one or more attachments.');
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await onSaveReport(record.id, report);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <tr>
        <td>
          <button type="button" className={historyStyles.toggleBtn} onClick={() => setExpanded((v) => !v)}>{expanded ? '−' : '+'}</button>
        </td>
        <td>{formatDateTime(record.scheduled_at)}</td>
        <td>{record.client_name}{record.company ? ` (${record.company})` : ''}</td>
        <td>{record.project_id ? <Link href={`/projects/${record.project_id}`}>{record.project_id}</Link> : '-'}</td>
        <td>{record.product_domain ? DOMAIN_DISPLAY_NAME[record.product_domain] : '-'}</td>
        <td>{domainLeadLabel(record.product_domain)}</td>
        <td>{record.technical_members.length ? record.technical_members.join(', ') : '-'}</td>
        <td>
          <span className={`${historyStyles.statusBadge} ${STATUS_CLASS[record.status]}`}>{STATUS_LABEL[record.status]}</span>
          {record.status === 'rejected' && record.decision_note && <div className={calcStyles.small}>{record.decision_note}</div>}
          {record.approved_by && (record.status === 'confirmed' || record.status === 'rejected') && (
            <div className={calcStyles.small}>by {record.approved_by}</div>
          )}
          {record.outcome && <div className={calcStyles.small}>Outcome: {OUTCOME_LABEL[record.outcome]}</div>}
        </td>
        <td>{record.created_by}</td>
        <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {record.status === 'pending' && isPrivileged && (
            <>
              <button type="button" className={historyStyles.primary} onClick={() => onApprove(record.id)}>Approve</button>
              <button type="button" className={historyStyles.deleteBtn} onClick={() => onReject(record.id)}>Reject</button>
            </>
          )}
          {(record.status === 'pending' || record.status === 'confirmed') && (record.created_by === currentUsername || isPrivileged) && (
            <button type="button" className={historyStyles.button} onClick={() => onCancel(record.id)}>Cancel</button>
          )}
          {record.status === 'confirmed' && (
            <button type="button" className={historyStyles.button} onClick={() => onMarkDone(record.id)}>Mark done</button>
          )}
          {isPrivileged && (
            <button type="button" className={historyStyles.deleteBtn} onClick={() => onDelete(record.id)}>Delete</button>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className={historyStyles.detailsRow}>
          <td colSpan={10}>
            {record.demo_objective && (
              <div className={calcStyles.field} style={{ marginBottom: 8 }}>
                <label className={calcStyles.label}>Demo objective</label>
                <div className={calcStyles.small}>{record.demo_objective}</div>
              </div>
            )}
            <h3 style={{ marginTop: 0 }}>Demo outcome &amp; report</h3>
            <div className={`${calcStyles.row} ${calcStyles.columns}`}>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Outcome</label>
                <select className={calcStyles.formControl} value={report.outcome} onChange={(e) => setReport((r) => ({ ...r, outcome: e.target.value as DemoOutcome }))}>
                  <option value="">-- Select outcome --</option>
                  {(Object.keys(OUTCOME_LABEL) as Exclude<DemoOutcome, ''>[]).map((o) => (
                    <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>
                  ))}
                </select>
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Customer rating (1-5)</label>
                <input type="number" min={0} max={5} className={calcStyles.formControl} value={report.customerRating} onChange={(e) => setReport((r) => ({ ...r, customerRating: Number(e.target.value) || 0 }))} />
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Next follow-up date</label>
                <input type="date" className={calcStyles.formControl} value={report.nextFollowUpDate} onChange={(e) => setReport((r) => ({ ...r, nextFollowUpDate: e.target.value }))} />
              </div>
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Key queries</label>
              <textarea className={calcStyles.formControl} rows={2} value={report.keyQueries} onChange={(e) => setReport((r) => ({ ...r, keyQueries: e.target.value }))} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Technical challenges</label>
              <textarea className={calcStyles.formControl} rows={2} value={report.technicalChallenges} onChange={(e) => setReport((r) => ({ ...r, technicalChallenges: e.target.value }))} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Unanswered queries</label>
              <textarea className={calcStyles.formControl} rows={2} value={report.unansweredQueries} onChange={(e) => setReport((r) => ({ ...r, unansweredQueries: e.target.value }))} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Suggested next action</label>
              <textarea className={calcStyles.formControl} rows={2} value={report.suggestedNextAction} onChange={(e) => setReport((r) => ({ ...r, suggestedNextAction: e.target.value }))} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Attachments</label>
              <input type="file" multiple disabled={uploading} onChange={(e) => handleUpload(e.target.files)} />
              {uploading && <div className={calcStyles.small}>Uploading…</div>}
              {report.attachments.length > 0 && (
                <div className={calcStyles.small}>
                  {report.attachments.map((url) => (
                    <div key={url}><a href={url} target="_blank" rel="noreferrer">{url.split('/').pop()}</a></div>
                  ))}
                </div>
              )}
            </div>
            <button type="button" className={calcStyles.btn} disabled={saving} onClick={handleSave}>
              {saving ? 'Saving…' : 'Save report'}
            </button>
          </td>
        </tr>
      )}
    </>
  );
}

function DemoScheduleContent({ currentUser }: { currentUser: { username: string; role: UserRole } }) {
  const searchParams = useSearchParams();
  const isPrivileged = currentUser.role === 'admin' || currentUser.role === 'superadmin' || currentUser.role === 'manager';
  const [records, setRecords] = useState<DemoScheduleRecord[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [projectQuotations, setProjectQuotations] = useState<QuotationRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState('Loading...');
  const [form, setForm] = useState({ ...EMPTY_FORM, projectId: searchParams.get('projectId') || '' });
  const [creating, setCreating] = useState(false);

  async function load() {
    setStatus('Loading...');
    try {
      const [dRes, pRes] = await Promise.all([fetch('/api/demo-schedule'), fetch('/api/projects')]);
      if (!dRes.ok) throw new Error(String(dRes.status));
      const data: DemoScheduleRecord[] = await dRes.json();
      setRecords(data);
      setProjects(pRes.ok ? await pRes.json() : []);
      setStatus(data.length ? `${data.length} demo${data.length === 1 ? '' : 's'} found.` : '');
      setLoaded(true);
    } catch {
      setStatus('Could not reach the demo schedule API. Try refreshing.');
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!form.projectId) {
      setProjectQuotations([]);
      return;
    }
    fetch(`/api/projects/${form.projectId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!json) return;
        setProjectQuotations(json.quotations || []);
        setForm((f) => ({
          ...f,
          company: f.company || json.project.company,
          location: f.location || json.project.address,
          clientName: f.clientName || json.project.client_name
        }));
      })
      .catch(() => setProjectQuotations([]));
  }, [form.projectId]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!form.projectId || !form.clientName.trim() || !form.scheduledAt) {
      alert('Project, client name, and scheduled date/time are required.');
      return;
    }
    setCreating(true);
    try {
      const response = await fetch('/api/demo-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      if (!response.ok) throw new Error(String(response.status));
      setForm(EMPTY_FORM);
      await load();
    } catch {
      alert('Could not save this demo request. Please try again.');
    } finally {
      setCreating(false);
    }
  }

  async function patchRecord(id: string, patch: Record<string, unknown>) {
    try {
      const response = await fetch(`/api/demo-schedule/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      });
      if (!response.ok) throw new Error(String(response.status));
      const updated: DemoScheduleRecord = await response.json();
      setRecords((prev) => prev.map((r) => (r.id === id ? updated : r)));
    } catch {
      alert('Could not update this request. Please try again.');
    }
  }

  function handleApprove(id: string) {
    patchRecord(id, { status: 'confirmed' });
  }

  function handleReject(id: string) {
    const note = window.prompt('Reason for rejecting this demo request (optional):', '') || '';
    patchRecord(id, { status: 'rejected', decisionNote: note });
  }

  function handleCancel(id: string) {
    if (!window.confirm('Cancel this demo request?')) return;
    patchRecord(id, { status: 'cancelled' });
  }

  function handleMarkDone(id: string) {
    patchRecord(id, { status: 'done' });
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this demo request? This cannot be undone.')) return;
    try {
      const response = await fetch(`/api/demo-schedule/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(String(response.status));
      setRecords((prev) => prev.filter((r) => r.id !== id));
    } catch {
      alert('Could not delete this demo request.');
    }
  }

  return (
    <div className={historyStyles.body}>
      <PortalHeader title="Demo Schedule" subtitle="Request a product demo — it's confirmed once the domain lead approves." />
      <main className={historyStyles.main}>
        <div className={historyStyles.detailPanel} style={{ marginTop: 0 }}>
          <p style={{ margin: 0 }}>Dear Team,</p>
          <p>Whenever you are scheduled to visit a client for a demo, please inform us in advance.</p>
          <p style={{ marginBottom: 4 }}>We maintain a centralized record of all demo visits to track:</p>
          <ul style={{ margin: '0 0 10px', paddingLeft: 20 }}>
            <li>Who is attending the demo</li>
            <li>Which product is being demonstrated</li>
            <li>Which client is being visited</li>
            <li>Demo Date &amp; Location</li>
            <li>Outcome of the Demo</li>
            <li>Key Queries / Technical Challenges</li>
            <li>Unanswered Queries</li>
          </ul>
          <p>This data helps us maintain accurate records, improve coordination, plan efficient future demos, and resolve customer queries promptly.</p>
          <p>If you have any questions or need clarification, please contact the Sales Coordinator.</p>
          <p style={{ marginBottom: 0 }}>Thank you for your cooperation.</p>
        </div>

        <h2 className={calcStyles.h2}>Request a demo</h2>
        <form className={calcStyles.sectionPanel} onSubmit={handleCreate}>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Project *</label>
              <select className={calcStyles.formControl} value={form.projectId} onChange={(e) => setForm((f) => ({ ...f, projectId: e.target.value, quotationId: '' }))} required>
                <option value="">-- Select project --</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.id} — {p.company || p.client_name}</option>
                ))}
              </select>
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Quotation</label>
              <select className={calcStyles.formControl} value={form.quotationId} onChange={(e) => setForm((f) => ({ ...f, quotationId: e.target.value }))} disabled={!form.projectId}>
                <option value="">-- None / not linked yet --</option>
                {projectQuotations.map((q) => (
                  <option key={q.id} value={q.id}>{q.quotation_number} — ₹{q.total.toLocaleString('en-IN')}</option>
                ))}
              </select>
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Client name *</label>
              <input className={calcStyles.formControl} value={form.clientName} onChange={(e) => setForm((f) => ({ ...f, clientName: e.target.value }))} required />
            </div>
          </div>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Company</label>
              <input className={calcStyles.formControl} value={form.company} onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Location</label>
              <input className={calcStyles.formControl} value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Product demonstrated</label>
              <select
                className={calcStyles.formControl}
                value={form.productDomain}
                onChange={(e) => setForm((f) => ({ ...f, productDomain: e.target.value as DomainKey | '' }))}
              >
                <option value="">-- Select product --</option>
                {(Object.keys(DOMAIN_DISPLAY_NAME) as DomainKey[]).map((k) => (
                  <option key={k} value={k}>{DOMAIN_DISPLAY_NAME[k]}</option>
                ))}
              </select>
            </div>
          </div>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Demo date &amp; time *</label>
              <input type="datetime-local" className={calcStyles.formControl} value={form.scheduledAt} onChange={(e) => setForm((f) => ({ ...f, scheduledAt: e.target.value }))} required />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Assigned rep</label>
              <input className={calcStyles.formControl} placeholder="Defaults to you" value={form.assignedRep} onChange={(e) => setForm((f) => ({ ...f, assignedRep: e.target.value }))} />
            </div>
          </div>
          <TeamCheckboxes
            label="Technical team member(s) required"
            options={TECHNICAL_TEAM}
            selected={form.technicalMembers}
            onChange={(next) => setForm((f) => ({ ...f, technicalMembers: next }))}
          />
          <div className={calcStyles.field}>
            <label className={calcStyles.label}>Demo objective</label>
            <textarea className={calcStyles.formControl} rows={2} value={form.demoObjective} onChange={(e) => setForm((f) => ({ ...f, demoObjective: e.target.value }))} />
          </div>
          <div className={calcStyles.field}>
            <label className={calcStyles.label}>Notes</label>
            <textarea className={calcStyles.formControl} rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </div>
          {form.productDomain && (
            <div className={calcStyles.small} style={{ marginBottom: 8 }}>
              This request will need approval from the {DOMAIN_DISPLAY_NAME[form.productDomain]} lead ({domainLeadLabel(form.productDomain)}).
            </div>
          )}
          <button type="submit" className={calcStyles.btn} disabled={creating}>
            {creating ? 'Sending…' : 'Send request'}
          </button>
        </form>

        <div className={historyStyles.toolbar} style={{ marginTop: 24 }}>
          <button type="button" className={historyStyles.button} onClick={load}>
            Refresh
          </button>
        </div>
        <div className={historyStyles.status}>{status}</div>
        {loaded && (
          <table className={historyStyles.table}>
            <thead>
              <tr>
                <th></th>
                <th>Scheduled</th>
                <th>Client</th>
                <th>Project</th>
                <th>Product</th>
                <th>Lead</th>
                <th>Technical Team</th>
                <th>Status</th>
                <th>Requested By</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {records.length === 0 ? (
                <tr>
                  <td colSpan={10} className={historyStyles.empty}>
                    No demo requests yet.
                  </td>
                </tr>
              ) : (
                records.map((r) => (
                  <DemoReportRow
                    key={r.id}
                    record={r}
                    isPrivileged={isPrivileged}
                    currentUsername={currentUser.username}
                    onApprove={handleApprove}
                    onReject={handleReject}
                    onCancel={handleCancel}
                    onMarkDone={handleMarkDone}
                    onDelete={handleDelete}
                    onSaveReport={patchRecord}
                  />
                ))
              )}
            </tbody>
          </table>
        )}
      </main>
    </div>
  );
}

export default function DemoScheduleView({ currentUser }: { currentUser: { username: string; role: UserRole } }) {
  return (
    <Suspense fallback={<div className={historyStyles.body} />}>
      <DemoScheduleContent currentUser={currentUser} />
    </Suspense>
  );
}
