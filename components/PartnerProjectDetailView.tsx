'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { PartnerRecord } from '@/lib/types';
import { PARTNER_STAGE_LABEL, PARTNER_STAGE_STEPS, PartnerProjectStage } from '@/lib/partnerProjectStages';
import { PROJECT_DEPARTMENT_LABEL } from '@/lib/projectDepartmentOptions';
import { OPPORTUNITY_TYPE_LABEL, OpportunityType } from '@/lib/projectLeadOptions';
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

export default function PartnerProjectDetailView({ projectId, partner }: { projectId: string; partner: PartnerRecord }) {
  const [project, setProject] = useState<PartnerProjectDetail | null>(null);
  const [quotations, setQuotations] = useState<SharedQuotation[]>([]);
  const [demos, setDemos] = useState<PartnerDemo[]>([]);
  const [tab, setTab] = useState<Tab>('overview');
  const [status, setStatus] = useState('Loading...');
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

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

      {project.review_remarks && (
        <p className={calcStyles.small}>
          <strong>From our sales team:</strong> {project.review_remarks}
        </p>
      )}

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
        <form className={calcStyles.sectionPanel} onSubmit={sendReply}>
          <h2 className={`${calcStyles.h2} ${calcStyles.h2Flush}`}>We need a little more information</h2>
          <p className={calcStyles.small}>Reply below and this goes straight back into our review queue.</p>
          <textarea className={calcStyles.formControl} rows={4} value={reply} onChange={(e) => setReply(e.target.value)} required />
          <button type="submit" className={calcStyles.btn} disabled={sending}>{sending ? 'Sending...' : 'Send reply'}</button>
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
            These are the details you submitted. To change anything, speak to your contact — our team keeps the
            project record from here.
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
