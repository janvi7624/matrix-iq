'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { PartnerRecord } from '@/lib/types';
import { PARTNER_STAGE_LABEL, PARTNER_STAGE_STEPS, PartnerProjectStage } from '@/lib/partnerProjectStages';
import { PROJECT_DEPARTMENT_LABEL } from '@/lib/projectDepartmentOptions';
import { OPPORTUNITY_TYPE_LABEL, OpportunityType } from '@/lib/projectLeadOptions';
import { awaitingSide, buildPartnerReviewThread } from '@/lib/partnerReviewThread';
import PartnerReviewThread from './PartnerReviewThread';
import PartnerShell from './PartnerShell';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import styles from './partnerPortal.module.css';

interface TimelineEntry {
  at: string;
  label: string;
  remarks: string;
}

interface PartnerProjectDetail {
  id: string;
  reference: string;
  project_name: string;
  client_name: string;
  company: string;
  city: string;
  state: string;
  address: string;
  phone: string;
  email: string;
  contact_person: string;
  alt_contact_phone: string;
  opportunity_type: string;
  priority: string;
  expected_closing_date: string;
  status: string;
  departments: string[];
  submitted_value: number | '';
  expected_timeline: string;
  stage: PartnerProjectStage;
  stage_label: string;
  progress_percent: number;
  action_required: boolean;
  submission_status: string;
  review_remarks: string;
  salesperson_name: string;
  submitted_at: string;
  last_activity_at: string;
  timeline: TimelineEntry[];
  notes: TimelineEntry[];
}

interface SharedQuotation {
  id: string;
  quotation_number: string;
  status: string;
  total: number;
  shared_at: string;
  project_id: string;
}

interface PartnerDemo {
  id: string;
  company: string;
  status_label: string;
  requested_date: string;
  scheduled_at: string;
  project_id: string;
}

type Tab = 'overview' | 'timeline' | 'quotations' | 'demos';

const STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  on_hold: 'On Hold',
  won: 'Won',
  lost: 'Lost'
};

function money(n: number | ''): string {
  return typeof n === 'number' && n > 0 ? `₹${n.toLocaleString('en-IN')}` : '—';
}

function date(value: string): string {
  return value ? new Date(value).toLocaleDateString('en-IN') : '—';
}

/** Read-only field, styled to match the internal Overview form's inputs. */
function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.readonlyField}>
      <span className={styles.readonlyLabel}>{label}</span>
      <div className={styles.readonlyValue}>{value || '—'}</div>
    </div>
  );
}

/**
 * One editable field in the revision form.
 *
 * Mirrors the read-only Field above it so the editor reads as the same form
 * the partner originally filled in, rather than as a different screen.
 */
function EditField({
  label,
  value,
  onChange,
  type = 'text'
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <div className={calcStyles.field}>
      <label className={calcStyles.label}>{label}</label>
      <input
        type={type}
        className={calcStyles.formControl}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...(type === 'number' ? { min: '0' } : {})}
      />
    </div>
  );
}

export default function PartnerProjectDetailView({ projectId, partner }: { projectId: string; partner: PartnerRecord }) {
  const [project, setProject] = useState<PartnerProjectDetail | null>(null);
  const [quotations, setQuotations] = useState<SharedQuotation[]>([]);
  const [demos, setDemos] = useState<PartnerDemo[]>([]);
  const [tab, setTab] = useState<Tab>('overview');
  const [status, setStatus] = useState('Loading...');
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  // Null until the partner opens the editor. Seeded from the project then,
  // not on load, so a background refresh can never overwrite what they are
  // part-way through typing.
  const [edits, setEdits] = useState<Record<string, string> | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/partner/projects/${projectId}`);
      if (!response.ok) {
        setStatus(response.status === 404 ? 'This project could not be found.' : 'Could not load this project.');
        return;
      }
      setProject(await response.json());
      setStatus('');
    } catch {
      setStatus('Could not reach the server.');
    }
  }, [projectId]);

  useEffect(() => {
    load();
    // The related tabs read the partner's own lists and filter to this
    // project — both are already partner-scoped server-side, so no extra
    // authorization surface is introduced by reusing them.
    fetch('/api/partner/quotations')
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: SharedQuotation[]) => setQuotations(rows.filter((q) => q.project_id === projectId)))
      .catch(() => setQuotations([]));
    fetch('/api/partner/demos')
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: PartnerDemo[]) => setDemos(rows.filter((d) => d.project_id === projectId)))
      .catch(() => setDemos([]));
  }, [load, projectId]);

  function openEditor() {
    if (!project) return;
    setError('');
    setEdits({
      project_name: project.project_name ?? '',
      client_name: project.client_name ?? '',
      company: project.company ?? '',
      contact_person: project.contact_person ?? '',
      phone: project.phone ?? '',
      alt_contact_phone: project.alt_contact_phone ?? '',
      email: project.email ?? '',
      address: project.address ?? '',
      city: project.city ?? '',
      state: project.state ?? '',
      expected_closing_date: project.expected_closing_date ?? '',
      partner_expected_timeline: project.expected_timeline ?? '',
      partner_submitted_value: project.submitted_value === '' ? '' : String(project.submitted_value)
      // remarks is deliberately absent: the editor has no field for it, and
      // seeding it here would post an empty string that wipes the
      // description the partner wrote at submission. Absent means untouched.
    });
  }

  async function sendRevision(event: FormEvent) {
    event.preventDefault();
    if (!edits) return;
    setError('');
    setSending(true);
    try {
      // Only the edited fields go up. Everything the editor does not cover —
      // departments, priority, attachments — is left untouched server-side
      // rather than posted back as empty.
      const response = await fetch(`/api/partner/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...edits, message: reply })
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.error || 'Could not save your changes.');
        return;
      }
      setEdits(null);
      setReply('');
      await load();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setSending(false);
    }
  }

  async function sendReply(event: FormEvent) {
    event.preventDefault();
    setError('');
    setSending(true);
    try {
      const response = await fetch(`/api/partner/projects/${projectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: reply })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(body?.error || 'Could not send your reply.');
        return;
      }
      setReply('');
      await load();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setSending(false);
    }
  }

  if (!project) {
    return (
      <PartnerShell title="Project" subtitle="" partnerName={partner.company_name} partnerCode={partner.partner_code}>
        <div className={historyStyles.status}>{status}</div>
        <Link className={historyStyles.button} href="/partner/projects">← All submissions</Link>
      </PartnerShell>
    );
  }

  const currentStep = PARTNER_STAGE_STEPS.indexOf(project.stage);
  const activity = [...project.timeline, ...project.notes].sort((a, b) => (a.at < b.at ? 1 : -1));
  // The same thread the sales reviewer reads, built by the same function —
  // so neither side can describe the exchange differently from the other.
  const reviewThread = buildPartnerReviewThread({ timeline: project.timeline, notes: project.notes });
  const sharedTotal = quotations.reduce((sum, q) => sum + (Number(q.total) || 0), 0);

  return (
    <PartnerShell
      title={project.company || project.client_name || 'Project'}
      subtitle={`${project.reference} — your submission with our sales team`}
      partnerName={partner.company_name}
      partnerCode={partner.partner_code}
    >
      <div style={{ marginBottom: 12 }}>
        <Link className={historyStyles.button} href="/partner/projects">← All submissions</Link>
      </div>

      {error && <div className={historyStyles.loginError}>{error}</div>}

      {/* Header — mirrors the internal detail header: title, the few facts
          that identify the deal, and the progress figure on the right. */}
      <div className={styles.detailHeader}>
        <div>
          <h2 className={styles.detailHeaderTitle}>{project.project_name || project.company}</h2>
          <div className={styles.detailHeaderMeta}>
            Customer: <b>{project.company || project.client_name || '—'}</b>
            {'   ·   '}Your contact: <b>{project.salesperson_name || 'Not yet assigned'}</b>
            {'   ·   '}Stage: <b>{project.stage_label}</b>
            {'   ·   '}Status: <b>{STATUS_LABEL[project.status] ?? project.status ?? '—'}</b>
          </div>
        </div>
        <div className={styles.progressRing}>
          <span className={styles.progressRingValue}>{project.progress_percent}%</span>
          <span className={styles.progressRingLabel}>Progress</span>
        </div>
      </div>

      <div className={styles.sectionBar}>Project Progress</div>
      <div className={styles.progressBarOuter}>
        <div className={styles.progressBarInner} style={{ width: `${project.progress_percent}%` }} />
      </div>

      {currentStep >= 0 ? (
        <div className={styles.stageTrack}>
          {PARTNER_STAGE_STEPS.map((step, i) => (
            <div
              key={step}
              className={`${styles.stageRow} ${i < currentStep ? styles.stageRowDone : ''} ${i === currentStep ? styles.stageRowCurrent : ''}`}
            >
              {PARTNER_STAGE_LABEL[step]}
            </div>
          ))}
        </div>
      ) : (
        /* Terminal and exception states are not steps — the stepper would
           imply a position on a path this project has left. */
        <div className={`${styles.stageRow} ${styles.stageRowCurrent}`}>{project.stage_label}</div>
      )}

      {/* The whole exchange, not just the latest remark. review_remarks is
          overwritten on every round, so on its own it loses the first
          question the moment a second one is asked. */}
      <PartnerReviewThread
        entries={reviewThread}
        partnerLabel={partner.company_name}
        waitingOn={awaitingSide(project.submission_status)}
        viewerSide="partner"
      />

      {/* Stat cards — the partner-facing counterpart of CLIENT DETAILS /
          SALES TEAM / QUOTATION AMOUNT / EXPECTED CLOSURE. ASSIGNED
          TECHNICAL TEAM is deliberately absent: who internally works the
          deal is staffing information. */}
      <div className={styles.statCardRow}>
        <div className={styles.statCard}>
          <span className={styles.statCardLabel}>Customer details</span>
          <span className={styles.statCardValue}>
            {project.client_name || project.company || '—'}
            <span className={styles.statCardSub}>{[project.phone, project.email].filter(Boolean).join(' · ') || '—'}</span>
          </span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statCardLabel}>Your contact</span>
          <span className={styles.statCardValue}>
            {project.salesperson_name || 'Not yet assigned'}
            <span className={styles.statCardSub}>Our sales team</span>
          </span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statCardLabel}>Quotations shared</span>
          <span className={styles.statCardValue}>
            {quotations.length ? money(sharedTotal) : '—'}
            <span className={styles.statCardSub}>{quotations.length} shared with you</span>
          </span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statCardLabel}>Expected closure</span>
          <span className={styles.statCardValue}>
            {date(project.expected_closing_date)}
            <span className={styles.statCardSub}>{project.expected_timeline || 'No timeline given'}</span>
          </span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statCardLabel}>Your estimate</span>
          <span className={styles.statCardValue}>
            {money(project.submitted_value)}
            <span className={styles.statCardSub}>As submitted by you</span>
          </span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statCardLabel}>Last activity</span>
          <span className={styles.statCardValue}>
            {date(project.last_activity_at)}
            <span className={styles.statCardSub}>Submitted {date(project.submitted_at)}</span>
          </span>
        </div>
      </div>

      {project.action_required && (
        <form className={calcStyles.sectionPanel} onSubmit={edits ? sendRevision : sendReply}>
          <h2 className={`${calcStyles.h2} ${calcStyles.h2Flush}`}>We need a little more information</h2>
          {error && <div className={historyStyles.loginError}>{error}</div>}

          {edits ? (
            <>
              <p className={calcStyles.small}>
                Correct whatever needs correcting. We record exactly which fields changed, so our team can see what you
                updated.
              </p>
              <div className={`${calcStyles.row} ${calcStyles.columns}`}>
                <EditField label="Project Name" value={edits.project_name} onChange={(v) => setEdits({ ...edits, project_name: v })} />
                <EditField label="Client Representative Name" value={edits.client_name} onChange={(v) => setEdits({ ...edits, client_name: v })} />
                <EditField label="Company" value={edits.company} onChange={(v) => setEdits({ ...edits, company: v })} />
                <EditField label="Contact Person" value={edits.contact_person} onChange={(v) => setEdits({ ...edits, contact_person: v })} />
                <EditField label="Phone" value={edits.phone} onChange={(v) => setEdits({ ...edits, phone: v })} />
                <EditField label="Alternate Contact Phone" value={edits.alt_contact_phone} onChange={(v) => setEdits({ ...edits, alt_contact_phone: v })} />
                <EditField label="Email" type="email" value={edits.email} onChange={(v) => setEdits({ ...edits, email: v })} />
                <EditField label="Address" value={edits.address} onChange={(v) => setEdits({ ...edits, address: v })} />
                <EditField label="City" value={edits.city} onChange={(v) => setEdits({ ...edits, city: v })} />
                <EditField label="State" value={edits.state} onChange={(v) => setEdits({ ...edits, state: v })} />
                <EditField
                  label="Expected Closing Date"
                  type="date"
                  value={edits.expected_closing_date ? edits.expected_closing_date.slice(0, 10) : ''}
                  onChange={(v) => setEdits({ ...edits, expected_closing_date: v })}
                />
                <EditField label="Expected Timeline" value={edits.partner_expected_timeline} onChange={(v) => setEdits({ ...edits, partner_expected_timeline: v })} />
                <EditField
                  label="Approx. Project Price (₹)"
                  type="number"
                  value={edits.partner_submitted_value}
                  onChange={(v) => setEdits({ ...edits, partner_submitted_value: v })}
                />
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Message to our sales team (optional)</label>
                <textarea className={calcStyles.formControl} rows={3} value={reply} onChange={(e) => setReply(e.target.value)} />
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button type="submit" className={calcStyles.btn} disabled={sending}>
                  {sending ? 'Sending...' : 'Save changes & send back'}
                </button>
                <button type="button" className={historyStyles.button} disabled={sending} onClick={() => { setEdits(null); setError(''); }}>
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <p className={calcStyles.small}>
                Reply below, or update the project details if something needs correcting. Either way it goes straight
                back into our review queue.
              </p>
              <textarea className={calcStyles.formControl} rows={4} value={reply} onChange={(e) => setReply(e.target.value)} required />
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
                <button type="submit" className={calcStyles.btn} disabled={sending}>{sending ? 'Sending...' : 'Send reply'}</button>
                <button type="button" className={historyStyles.button} onClick={openEditor}>Edit project details</button>
              </div>
            </>
          )}
        </form>
      )}

      {/* Tabs mirror the internal detail view, trimmed to what a partner has
          any stake in. Site Visits, Customer Responses, Negotiations,
          Delivery Challans, Marketing Requests and Purchase Orders are all
          internal execution records and have no partner tab. */}
      <div className={styles.tabStrip}>
        {([
          ['overview', 'Overview'],
          ['timeline', 'Timeline'],
          ['quotations', `Quotations${quotations.length ? ` (${quotations.length})` : ''}`],
          ['demos', `Demo${demos.length ? ` (${demos.length})` : ''}`]
        ] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`${styles.tab} ${tab === key ? styles.tabActive : ''}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className={calcStyles.sectionPanel}>
          <div className={styles.readonlyGrid}>
            <Field label="Project Name" value={project.project_name} />
            <Field label="Client Representative Name" value={project.client_name} />
            <Field label="Company" value={project.company} />
            <Field label="Phone" value={project.phone} />
            <Field label="Email" value={project.email} />
            <Field label="Address" value={project.address} />
            <Field label="State" value={project.state} />
            <Field label="City" value={project.city} />
            <Field label="Alternate Contact Name" value={project.contact_person} />
            <Field label="Alternate Contact Phone" value={project.alt_contact_phone} />
            <Field
              label="Opportunity Type"
              value={OPPORTUNITY_TYPE_LABEL[project.opportunity_type as OpportunityType] ?? project.opportunity_type}
            />
            <Field
              label="Department"
              value={project.departments
                .map((d) => PROJECT_DEPARTMENT_LABEL[d as keyof typeof PROJECT_DEPARTMENT_LABEL] ?? d)
                .join(', ')}
            />
            <Field label="Priority" value={project.priority ? project.priority[0].toUpperCase() + project.priority.slice(1) : ''} />
            <Field label="Status" value={STATUS_LABEL[project.status] ?? project.status} />
            <Field label="Current stage" value={project.stage_label} />
            <Field label="Expected closing date" value={date(project.expected_closing_date)} />
            <Field label="Expected timeline" value={project.expected_timeline} />
            <Field label="Approx. Project Price (₹)" value={money(project.submitted_value)} />
          </div>
          <p className={calcStyles.small}>
            {project.action_required
              ? 'These are the details you submitted. Our sales team has asked for changes, so you can edit them above.'
              : 'These are the details you submitted. To change anything, speak to your contact — our team keeps the project record from here.'}
          </p>
        </div>
      )}

      {tab === 'timeline' && (
        <div className={historyStyles.tableWrap}>
          {activity.length === 0 ? (
            <p className={styles.pending}>No updates to show yet. Progress on this project will appear here.</p>
          ) : (
            <table className={historyStyles.table}>
              <thead>
                <tr><th>Date</th><th>Update</th><th>Details</th></tr>
              </thead>
              <tbody>
                {activity.map((entry, i) => (
                  <tr key={`${entry.at}-${i}`}>
                    <td>{date(entry.at)}</td>
                    <td>{entry.label}</td>
                    <td>{entry.remarks || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'quotations' && (
        <div className={historyStyles.tableWrap}>
          {quotations.length === 0 ? (
            <p className={styles.pending}>
              No quotations have been shared with you for this project yet. Your contact shares them when they are ready.
            </p>
          ) : (
            <table className={historyStyles.table}>
              <thead>
                <tr><th>Quotation</th><th>Status</th><th>Total</th><th>Shared</th><th></th></tr>
              </thead>
              <tbody>
                {quotations.map((q) => (
                  <tr key={q.id}>
                    <td>{q.quotation_number}</td>
                    <td><span className={historyStyles.statusPill}>{q.status}</span></td>
                    <td>{money(q.total)}</td>
                    <td>{date(q.shared_at)}</td>
                    <td><Link className={historyStyles.button} href="/partner/quotations">Open</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'demos' && (
        <div className={historyStyles.tableWrap}>
          {demos.length === 0 ? (
            <p className={styles.pending}>
              No demo requested for this project. You can request one from the Demo Requests page.
            </p>
          ) : (
            <table className={historyStyles.table}>
              <thead>
                <tr><th>Customer</th><th>Status</th><th>Requested for</th><th>Confirmed</th></tr>
              </thead>
              <tbody>
                {demos.map((d) => (
                  <tr key={d.id}>
                    <td>{d.company}</td>
                    <td><span className={historyStyles.statusPill}>{d.status_label}</span></td>
                    <td>{date(d.requested_date)}</td>
                    <td>{d.scheduled_at ? new Date(d.scheduled_at).toLocaleString('en-IN') : 'Not yet confirmed'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </PartnerShell>
  );
}
