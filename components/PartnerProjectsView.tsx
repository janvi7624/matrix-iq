'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { PartnerRecord } from '@/lib/types';
import { ProjectDepartment, PROJECT_DEPARTMENT_LABEL } from '@/lib/projectDepartmentOptions';
import { OpportunityType } from '@/lib/projectLeadOptions';
import { PARTNER_STAGE_LABEL, PARTNER_STAGE_STEPS, PartnerProjectStage } from '@/lib/partnerProjectStages';
import { todayDateInputValue } from '@/lib/dateHelpers';
import ProjectIntakeFields, { EMPTY_PROJECT_INTAKE, ProjectLocationFields } from './ui/ProjectIntakeFields';
import ProjectDepartmentField from './ui/ProjectDepartmentField';
import OpportunityTypeField from './ui/OpportunityTypeField';
import PhoneInput from './ui/PhoneInput';
import PartnerShell from './PartnerShell';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import styles from './partnerPortal.module.css';

interface PartnerProject {
  id: string;
  reference: string;
  project_name: string;
  client_name: string;
  company: string;
  city: string;
  state: string;
  departments: string[];
  priority: string;
  status: string;
  expected_closing_date: string;
  stage: string;
  stage_label: string;
  progress_percent: number;
  action_required: boolean;
  submission_status: string;
  submitted_value: number | '';
  salesperson_name: string;
  submitted_at: string;
  last_activity_at: string;
}

const STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  on_hold: 'On Hold',
  won: 'Won',
  lost: 'Lost'
};

function money(n: number | ''): string {
  return typeof n === 'number' && n > 0 ? `₹${n.toLocaleString('en-IN')}` : '₹0';
}

interface Props {
  viewerName: string;
  partner: PartnerRecord;
}

// Mirrors the internal New Project form (components/ProjectsView.tsx) field
// for field, minus the three internal-person pickers — Sales person,
// Technical Person(s) and Project Lead — which the sales manager sets when
// they accept the submission. Source is fixed to 'Partner' by the server, so
// it has no control here either.
const EMPTY_FORM = {
  client_name: '',
  company: '',
  phone: '',
  email: '',
  address: '',
  contact_person: '',
  alt_contact_phone: '',
  opportunity_type: '' as OpportunityType | '',
  departments: [] as ProjectDepartment[],
  priority: 'medium',
  expected_closing_date: '',
  partner_submitted_value: '',
  partner_expected_timeline: '',
  remarks: '',
  // Project name / state / city, shared with the internal form via
  // ProjectLocationFields.
  ...EMPTY_PROJECT_INTAKE
};

export default function PartnerProjectsView({ partner }: Props) {
  const [projects, setProjects] = useState<PartnerProject[]>([]);
  const [status, setStatus] = useState('Loading...');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/partner/projects');
      if (!response.ok) throw new Error(String(response.status));
      const data: PartnerProject[] = await response.json();
      setProjects(data);
      setStatus(data.length ? '' : 'You have not submitted anything yet.');
    } catch {
      setStatus('Could not load your submissions. Refresh to try again.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // The same six figures the internal Project Dashboard leads with, read
  // through the partner's own lens: their submissions, not the pipeline.
  const kpis = useMemo(() => {
    const awaiting = projects.filter((p) => p.submission_status === 'submitted' || p.submission_status === 'info_requested').length;
    const approved = projects.filter((p) => p.submission_status === 'approved');
    return {
      total: projects.length,
      awaiting,
      active: approved.filter((p) => p.status === 'active').length,
      onHold: approved.filter((p) => p.status === 'on_hold').length,
      won: approved.filter((p) => p.status === 'won').length,
      lost: approved.filter((p) => p.status === 'lost').length,
      // Labelled as the partner's own estimate, never as pipeline value —
      // these are unvetted figures they submitted.
      estimate: projects.reduce((sum, p) => sum + (typeof p.submitted_value === 'number' ? p.submitted_value : 0), 0)
    };
  }, [projects]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return projects.filter((p) => {
      if (stageFilter !== 'all' && p.stage !== stageFilter) return false;
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (!needle) return true;
      return (
        p.company.toLowerCase().includes(needle) ||
        p.client_name.toLowerCase().includes(needle) ||
        p.project_name.toLowerCase().includes(needle) ||
        p.reference.toLowerCase().includes(needle)
      );
    });
  }, [projects, search, stageFilter, statusFilter]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const response = await fetch('/api/partner/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // ProjectLocationFields uses the internal form's camelCase names;
        // the API speaks the column names. Mapped here rather than renaming
        // the shared component, which the internal form also depends on.
        body: JSON.stringify({
          ...form,
          project_name: form.projectName,
          state: form.state,
          city: form.city
        })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(body?.error || 'Could not submit. Please check the form and try again.');
        return;
      }
      setForm(EMPTY_FORM);
      setShowForm(false);
      await load();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PartnerShell
      title="My Leads / Projects"
      subtitle="Opportunities you have sent us, and how each one is progressing"
      partnerName={partner.company_name}
      partnerCode={partner.partner_code}
    >
      {error && <div className={historyStyles.loginError}>{error}</div>}

      {showForm ? (
        <form className={calcStyles.sectionPanel} onSubmit={handleSubmit}>
          <h2 className={`${calcStyles.h2} ${calcStyles.h2Flush}`}>Submit an opportunity</h2>

          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="pclient">Client Representative Name</label>
              <input id="pclient" className={calcStyles.formControl} value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="pcompany">Company</label>
              <input id="pcompany" className={calcStyles.formControl} value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
            </div>
          </div>

          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Phone</label>
              <PhoneInput value={form.phone} onChange={(v) => setForm((f) => ({ ...f, phone: v }))} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="pemail">Email</label>
              <input id="pemail" type="email" className={calcStyles.formControl} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="paddr">Address</label>
              <input id="paddr" className={calcStyles.formControl} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </div>
          </div>

          {/* Project name / State / City — the same component the internal
              form uses, so the state+city dropdowns behave identically. */}
          <ProjectLocationFields values={form} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} />

          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="paltname">Alternate Contact Name (optional)</label>
              <input id="paltname" className={calcStyles.formControl} value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Alternate Contact Phone (optional)</label>
              <PhoneInput value={form.alt_contact_phone} onChange={(v) => setForm((f) => ({ ...f, alt_contact_phone: v }))} />
            </div>
          </div>

          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Opportunity Type</label>
              <OpportunityTypeField value={form.opportunity_type} onChange={(v) => setForm((f) => ({ ...f, opportunity_type: v }))} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Department</label>
              {/* Same picker as the internal form, with the per-department
                  VALUE SPLIT turned off: a split is a division of our
                  approx_price, which Sales only sets on acceptance, so the
                  boxes would collect numbers the server discards. */}
              <ProjectDepartmentField
                showAmounts={false}
                departments={form.departments}
                amounts={{}}
                onChange={(departments) => setForm((f) => ({ ...f, departments }))}
              />
              <span className={calcStyles.small}>Tick every team you think this deal involves.</span>
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="ppriority">Priority</label>
              <select id="ppriority" className={calcStyles.formControl} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
          </div>

          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="pclose">Expected closing date</label>
              <input
                id="pclose"
                type="date"
                min={todayDateInputValue()}
                className={calcStyles.formControl}
                value={form.expected_closing_date}
                onChange={(e) => setForm({ ...form, expected_closing_date: e.target.value })}
              />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="pvalue">Approx. Project Price (₹)</label>
              <input
                id="pvalue"
                type="number"
                min={1}
                step="0.01"
                placeholder="e.g. 1250000"
                className={calcStyles.formControl}
                value={form.partner_submitted_value}
                onChange={(e) => setForm({ ...form, partner_submitted_value: e.target.value })}
              />
              {/* Said plainly because the two numbers are easy to conflate:
                  this is recorded as the partner's estimate, and our own
                  figure is set separately when the submission is accepted. */}
              <span className={calcStyles.small}>Your estimate. Our team sets its own figure when reviewing.</span>
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="ptimeline">Expected timeline</label>
              <input id="ptimeline" className={calcStyles.formControl} placeholder="e.g. Q3 2026, within 2 months" value={form.partner_expected_timeline} onChange={(e) => setForm({ ...form, partner_expected_timeline: e.target.value })} />
            </div>
          </div>

          {/* Payment terms, and the Referral / Tender blocks. Source is fixed
              to 'Partner' for a submission, so the two conditional blocks
              stay closed — the component is still used so the form picks up
              any future unconditional intake field automatically. */}
          <ProjectIntakeFields source="Partner" values={form} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} />

          <div className={calcStyles.field}>
            <label className={calcStyles.label} htmlFor="premarks">Remarks</label>
            <textarea id="premarks" rows={3} className={calcStyles.formControl} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
          </div>

          <p className={calcStyles.small}>
            Your sales manager assigns the salesperson and technical team when they review this.
          </p>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="submit" className={calcStyles.btn} disabled={submitting}>{submitting ? 'Submitting...' : 'Submit for review'}</button>
            <button type="button" className={historyStyles.button} onClick={() => { setShowForm(false); setError(''); }}>Cancel</button>
          </div>
        </form>
      ) : (
        <section className={styles.intro}>
          <h2 className={styles.introTitle}>Submit an opportunity</h2>
          <p className={styles.introSub}>
            Send us a lead or project and our sales team will review it. You will see the decision here, and can follow the
            project through to close.
          </p>
          <button type="button" className={calcStyles.btn} style={{ marginTop: 12 }} onClick={() => setShowForm(true)}>+ New submission</button>
        </section>
      )}

      <h3 className={styles.sectionHeading}>Your submissions</h3>

      {/* The same KPI strip the internal Project Dashboard opens with. */}
      <div className={styles.kpiRow}>
        <div className={styles.kpi}>
          <span className={styles.kpiValue}>{kpis.total}</span>
          <span className={styles.kpiLabel}>Total</span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiValue}>{kpis.awaiting}</span>
          <span className={styles.kpiLabel}>Awaiting review</span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiValue}>{kpis.active}</span>
          <span className={styles.kpiLabel}>Active</span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiValue}>{kpis.onHold}</span>
          <span className={styles.kpiLabel}>On Hold</span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiValue}>{kpis.won}</span>
          <span className={styles.kpiLabel}>Won</span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiValue}>{kpis.lost}</span>
          <span className={styles.kpiLabel}>Lost</span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiValue}>{money(kpis.estimate)}</span>
          {/* Deliberately "Your estimates", not "Total Value": these are
              figures the partner submitted, not business we have booked. */}
          <span className={styles.kpiLabel}>Your estimates</span>
        </div>
      </div>

      <div className={historyStyles.toolbar}>
        <input
          type="text"
          placeholder="Search customer, project, reference…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}>
          <option value="all">All stages</option>
          {PARTNER_STAGE_STEPS.map((stage) => (
            <option key={stage} value={stage}>{PARTNER_STAGE_LABEL[stage]}</option>
          ))}
          {(['info_requested', 'rejected', 'won', 'lost', 'on_hold'] as PartnerProjectStage[]).map((stage) => (
            <option key={stage} value={stage}>{PARTNER_STAGE_LABEL[stage]}</option>
          ))}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All statuses</option>
          {Object.entries(STATUS_LABEL).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </div>

      <div className={historyStyles.status}>
        {status || `${visible.length} of ${projects.length} project${projects.length === 1 ? '' : 's'}`}
      </div>

      {visible.length > 0 && (
        <div className={historyStyles.tableWrap}>
          <table className={historyStyles.table}>
            <thead>
              <tr>
                <th>Customer</th>
                <th>Reference</th>
                <th>Department</th>
                <th>Your contact</th>
                <th>Your estimate</th>
                <th>Stage</th>
                <th>Status</th>
                <th>Expected closure</th>
                <th>Last updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.company || p.client_name}
                    {p.project_name && <div className={calcStyles.small}>{p.project_name}</div>}
                    {p.city && <div className={calcStyles.small}>{[p.city, p.state].filter(Boolean).join(', ')}</div>}
                  </td>
                  <td>{p.reference}</td>
                  <td>
                    {p.departments.length
                      ? p.departments.map((d) => PROJECT_DEPARTMENT_LABEL[d as keyof typeof PROJECT_DEPARTMENT_LABEL] ?? d).join(' + ')
                      : '—'}
                  </td>
                  <td>{p.salesperson_name || <span className={styles.cardDesc}>Not yet assigned</span>}</td>
                  <td>{money(p.submitted_value)}</td>
                  <td>
                    <span className={historyStyles.statusPill}>{p.stage_label}</span>
                    {p.action_required && <div className={calcStyles.small}><strong>Needs your reply</strong></div>}
                  </td>
                  <td>{STATUS_LABEL[p.status] ?? p.status ?? '—'}</td>
                  <td>{p.expected_closing_date ? new Date(p.expected_closing_date).toLocaleDateString('en-IN') : '—'}</td>
                  <td>{p.last_activity_at ? new Date(p.last_activity_at).toLocaleDateString('en-IN') : '—'}</td>
                  <td><Link className={historyStyles.button} href={`/partner/projects/${p.id}`}>Open</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PartnerShell>
  );
}
