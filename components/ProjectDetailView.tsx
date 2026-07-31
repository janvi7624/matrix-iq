'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  CustomerResponseRecord,
  DemoScheduleRecord,
  InstallationRecord,
  NegotiationRecord,
  PoRecord,
  ProjectPriority,
  ProjectRecord,
  ProjectStage,
  ProjectStatus,
  QuotationRecord,
  SiteVisitRecord,
  UserRole
} from '@/lib/types';
import { FORWARD_STAGES, STAGE_LABEL, stageProgressPercent } from '@/lib/projectStages';
import { DOMAIN_DISPLAY_NAME } from '@/lib/domainLabels';
import { STAGE_LABEL as VISIT_STAGE_LABEL } from '@/lib/siteVisitReminder';
import { exportListToPdf } from '@/lib/exportPdf';
import PortalHeader from './PortalHeader';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';

interface DetailResponse {
  project: ProjectRecord;
  siteVisits: SiteVisitRecord[];
  quotations: QuotationRecord[];
  demos: DemoScheduleRecord[];
  responses: CustomerResponseRecord[];
  negotiations: NegotiationRecord[];
  purchaseOrders: PoRecord[];
  installations: InstallationRecord[];
}

const STATUS_LABEL: Record<ProjectStatus, string> = { active: 'Active', on_hold: 'On Hold', won: 'Won', lost: 'Lost' };
const PRIORITY_LABEL: Record<ProjectPriority, string> = { low: 'Low', medium: 'Medium', high: 'High' };

function formatDate(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleDateString('en-IN');
  } catch {
    return iso;
  }
}

function formatDateTime(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('en-IN');
  } catch {
    return iso;
  }
}

const EMPTY_NEGOTIATION = { discussionDate: '', person: '', discussion: '', offerGiven: '', discount: '', revisedPrice: '', expectedClosure: '' };
const EMPTY_PO = { poNumber: '', poDate: '', amount: '', advanceReceived: '', paymentTerms: '' };
const EMPTY_INSTALLATION = { installationDate: '', assignedEngineer: '' };
const EMPTY_RESPONSE = { feedback: '', responseType: '' as CustomerResponseRecord['response_type'], expectedDecisionDate: '', remarks: '' };

interface ProjectDetailViewProps {
  projectId: string;
  currentUser: { username: string; role: UserRole };
}

export default function ProjectDetailView({ projectId, currentUser }: ProjectDetailViewProps) {
  const isPrivileged = currentUser.role === 'admin' || currentUser.role === 'superadmin' || currentUser.role === 'manager';
  const [data, setData] = useState<DetailResponse | null>(null);
  const [status, setStatus] = useState('Loading...');
  const [remarkText, setRemarkText] = useState('');
  const [savingRemark, setSavingRemark] = useState(false);

  const [negForm, setNegForm] = useState(EMPTY_NEGOTIATION);
  const [poForm, setPoForm] = useState(EMPTY_PO);
  const [instForm, setInstForm] = useState(EMPTY_INSTALLATION);
  const [respForm, setRespForm] = useState(EMPTY_RESPONSE);
  const [busySection, setBusySection] = useState('');

  async function load() {
    setStatus('Loading...');
    try {
      const response = await fetch(`/api/projects/${projectId}`);
      if (!response.ok) throw new Error(String(response.status));
      const json: DetailResponse = await response.json();
      setData(json);
      setStatus('');
    } catch {
      setStatus('Could not load this project. Try refreshing.');
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const canEdit = useMemo(() => isPrivileged || data?.project.created_by === currentUser.username, [isPrivileged, data, currentUser.username]);

  async function patchProject(patch: Record<string, unknown>) {
    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      });
      if (!response.ok) throw new Error(String(response.status));
      await load();
    } catch {
      alert('Could not save this change. Please try again.');
    }
  }

  async function handleAddRemark(e: FormEvent) {
    e.preventDefault();
    if (!remarkText.trim()) return;
    setSavingRemark(true);
    try {
      await patchProject({ action: 'addRemark', remarks: remarkText });
      setRemarkText('');
    } finally {
      setSavingRemark(false);
    }
  }

  async function handleAddNegotiation(e: FormEvent) {
    e.preventDefault();
    if (!negForm.discussionDate) {
      alert('Discussion date is required.');
      return;
    }
    setBusySection('negotiation');
    try {
      const response = await fetch('/api/negotiation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, ...negForm, revisedPrice: Number(negForm.revisedPrice) || 0 })
      });
      if (!response.ok) throw new Error(String(response.status));
      setNegForm(EMPTY_NEGOTIATION);
      await load();
    } catch {
      alert('Could not save this negotiation entry.');
    } finally {
      setBusySection('');
    }
  }

  async function handleDeleteNegotiation(id: string) {
    if (!window.confirm('Delete this negotiation entry?')) return;
    await fetch(`/api/negotiation/${id}`, { method: 'DELETE' });
    await load();
  }

  async function handleAddPo(e: FormEvent) {
    e.preventDefault();
    if (!poForm.poNumber.trim()) {
      alert('PO number is required.');
      return;
    }
    setBusySection('po');
    try {
      const response = await fetch('/api/po', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, ...poForm, amount: Number(poForm.amount) || 0, advanceReceived: Number(poForm.advanceReceived) || 0 })
      });
      if (!response.ok) throw new Error(String(response.status));
      setPoForm(EMPTY_PO);
      await load();
    } catch {
      alert('Could not save this PO.');
    } finally {
      setBusySection('');
    }
  }

  async function handleDeletePo(id: string) {
    if (!window.confirm('Delete this PO?')) return;
    await fetch(`/api/po/${id}`, { method: 'DELETE' });
    await load();
  }

  async function handleAddInstallation(e: FormEvent) {
    e.preventDefault();
    if (!instForm.installationDate) {
      alert('Installation date is required.');
      return;
    }
    setBusySection('installation');
    try {
      const response = await fetch('/api/installation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, ...instForm })
      });
      if (!response.ok) throw new Error(String(response.status));
      setInstForm(EMPTY_INSTALLATION);
      await load();
    } catch {
      alert('Could not save this installation.');
    } finally {
      setBusySection('');
    }
  }

  async function handleInstallationStatus(id: string, statusValue: InstallationRecord['status']) {
    await fetch(`/api/installation/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: statusValue })
    });
    await load();
  }

  async function handleAddResponse(e: FormEvent) {
    e.preventDefault();
    setBusySection('response');
    try {
      const response = await fetch('/api/customer-response', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, ...respForm })
      });
      if (!response.ok) throw new Error(String(response.status));
      setRespForm(EMPTY_RESPONSE);
      await load();
    } catch {
      alert('Could not save this response.');
    } finally {
      setBusySection('');
    }
  }

  function handleExportPdf() {
    if (!data) return;
    exportListToPdf(
      `Project ${data.project.id} — Activity Timeline`,
      ['Date', 'Stage', 'Event', 'By', 'Remarks'],
      data.project.timeline.map((t) => [formatDateTime(t.at), STAGE_LABEL[t.stage as ProjectStage] || t.stage, t.label, t.by, t.remarks]),
      `project-${data.project.id}-timeline.pdf`
    );
  }

  if (!data) {
    return (
      <div className={historyStyles.body}>
        <PortalHeader title="Project Detail" subtitle="Loading…" />
        <main className={historyStyles.main}>
          <div className={historyStyles.status}>{status}</div>
        </main>
      </div>
    );
  }

  const { project, siteVisits, quotations, demos, responses, negotiations, purchaseOrders, installations } = data;
  const currentIdx = FORWARD_STAGES.indexOf(project.stage);
  const totalPoAmount = purchaseOrders.reduce((sum, po) => sum + po.amount, 0);
  const totalAdvance = purchaseOrders.reduce((sum, po) => sum + po.advance_received, 0);

  return (
    <div className={historyStyles.body}>
      <PortalHeader title={`Project ${project.id}`} subtitle={project.company || project.client_name || 'Project detail'} />
      <main className={historyStyles.main}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          <Link className={historyStyles.button} href="/projects">
            &larr; All Projects
          </Link>
          <button type="button" className={historyStyles.button} onClick={handleExportPdf}>
            Export Timeline PDF
          </button>
          <button type="button" className={historyStyles.button} onClick={() => window.print()}>
            Print
          </button>
        </div>

        <div className={historyStyles.detailPanel} style={{ marginTop: 0 }}>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Client</label>
              <div className={calcStyles.small}>{project.client_name || '-'}</div>
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Company</label>
              <div className={calcStyles.small}>{project.company || '-'}</div>
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Contact person</label>
              <div className={calcStyles.small}>{project.contact_person || '-'}</div>
            </div>
          </div>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Phone</label>
              <div className={calcStyles.small}>{project.phone || '-'}</div>
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Email</label>
              <div className={calcStyles.small}>{project.email || '-'}</div>
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Address</label>
              <div className={calcStyles.small}>{project.address || '-'}</div>
            </div>
          </div>

          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Sales person</label>
              <div className={calcStyles.small}>{project.sales_person}</div>
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Priority</label>
              {canEdit ? (
                <select className={calcStyles.formControl} value={project.priority} onChange={(e) => patchProject({ priority: e.target.value })}>
                  {(Object.keys(PRIORITY_LABEL) as ProjectPriority[]).map((p) => (
                    <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
                  ))}
                </select>
              ) : (
                <div className={calcStyles.small}>{PRIORITY_LABEL[project.priority]}</div>
              )}
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Status</label>
              {canEdit ? (
                <select className={calcStyles.formControl} value={project.status} onChange={(e) => patchProject({ status: e.target.value })}>
                  {(Object.keys(STATUS_LABEL) as ProjectStatus[]).map((s) => (
                    <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                  ))}
                </select>
              ) : (
                <div className={calcStyles.small}>{STATUS_LABEL[project.status]}</div>
              )}
            </div>
          </div>

          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Current stage</label>
              {canEdit ? (
                <select className={calcStyles.formControl} value={project.stage} onChange={(e) => patchProject({ stage: e.target.value })}>
                  {FORWARD_STAGES.concat('closed_lost').map((s) => (
                    <option key={s} value={s}>{STAGE_LABEL[s as ProjectStage]}</option>
                  ))}
                </select>
              ) : (
                <div className={calcStyles.small}>{STAGE_LABEL[project.stage]}</div>
              )}
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Expected closing date</label>
              {canEdit ? (
                <input type="date" className={calcStyles.formControl} value={project.expected_closing_date} onChange={(e) => patchProject({ expectedClosingDate: e.target.value })} />
              ) : (
                <div className={calcStyles.small}>{formatDate(project.expected_closing_date)}</div>
              )}
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Next follow-up date</label>
              {canEdit ? (
                <input type="date" className={calcStyles.formControl} value={project.next_follow_up_date} onChange={(e) => patchProject({ nextFollowUpDate: e.target.value })} />
              ) : (
                <div className={calcStyles.small}>{formatDate(project.next_follow_up_date)}</div>
              )}
            </div>
          </div>

          <div className={historyStyles.progressTrack} style={{ marginTop: 10 }}>
            <div
              className={`${historyStyles.progressFill} ${project.status === 'lost' ? historyStyles.progressFillLost : ''}`}
              style={{ width: `${project.status === 'lost' ? 100 : stageProgressPercent(project.stage)}%` }}
            />
          </div>

          <div className={historyStyles.stepper}>
            {project.stage === 'closed_lost' || project.status === 'lost' ? (
              <span className={`${historyStyles.step} ${historyStyles.stepLost}`}>✕ Closed Lost</span>
            ) : (
              FORWARD_STAGES.map((s, idx) => (
                <span
                  key={s}
                  className={`${historyStyles.step} ${idx < currentIdx ? historyStyles.stepDone : idx === currentIdx ? historyStyles.stepCurrent : ''}`}
                >
                  {idx < currentIdx ? '✓ ' : ''}
                  {STAGE_LABEL[s]}
                </span>
              ))
            )}
          </div>
        </div>

        <div className={historyStyles.cardGrid}>
          <div className={historyStyles.miniCard}>
            <div className={historyStyles.miniCardTitle}>
              Site Visits ({siteVisits.length})
              <Link href={`/site-visits?projectId=${project.id}`}>+ Add</Link>
            </div>
            {siteVisits.length === 0 ? (
              <div className={historyStyles.miniCardEmpty}>No site visits logged yet.</div>
            ) : (
              siteVisits.map((v) => (
                <div key={v.id} className={historyStyles.miniCardRow}>
                  {formatDate(v.visit_date)} — {v.location || 'No location'} {v.stage ? `· ${VISIT_STAGE_LABEL[v.stage]}` : ''}
                </div>
              ))
            )}
          </div>

          <div className={historyStyles.miniCard}>
            <div className={historyStyles.miniCardTitle}>
              Quotations ({quotations.length})
              <Link href={`/quotation?projectId=${project.id}`}>+ Add</Link>
            </div>
            {quotations.length === 0 ? (
              <div className={historyStyles.miniCardEmpty}>No quotations yet.</div>
            ) : (
              quotations.map((q) => (
                <div key={q.id} className={historyStyles.miniCardRow}>
                  {q.quotation_number} — ₹{q.total.toLocaleString('en-IN')}
                </div>
              ))
            )}
          </div>

          <div className={historyStyles.miniCard}>
            <div className={historyStyles.miniCardTitle}>
              Demos ({demos.length})
              <Link href={`/demo-schedule?projectId=${project.id}`}>+ Add</Link>
            </div>
            {demos.length === 0 ? (
              <div className={historyStyles.miniCardEmpty}>No demos requested yet.</div>
            ) : (
              demos.map((d) => (
                <div key={d.id} className={historyStyles.miniCardRow}>
                  {formatDateTime(d.scheduled_at)} — {d.status}{d.outcome ? ` · ${d.outcome.replace(/_/g, ' ')}` : ''} {d.product_domain ? `(${DOMAIN_DISPLAY_NAME[d.product_domain]})` : ''}
                </div>
              ))
            )}
          </div>

          <div className={historyStyles.miniCard}>
            <div className={historyStyles.miniCardTitle}>Customer Response ({responses.length})</div>
            {responses.length === 0 ? (
              <div className={historyStyles.miniCardEmpty}>No response logged yet.</div>
            ) : (
              responses.map((r) => (
                <div key={r.id} className={historyStyles.miniCardRow}>
                  {formatDate(r.created_at)} — {r.response_type ? r.response_type.replace(/_/g, ' ') : 'No decision yet'}
                </div>
              ))
            )}
            <form onSubmit={handleAddResponse} style={{ marginTop: 10 }}>
              <select className={calcStyles.formControl} value={respForm.responseType} onChange={(e) => setRespForm((f) => ({ ...f, responseType: e.target.value as CustomerResponseRecord['response_type'] }))} style={{ marginBottom: 6 }}>
                <option value="">-- Response type --</option>
                <option value="interested">Interested</option>
                <option value="not_interested">Not interested</option>
                <option value="need_revision">Need revision</option>
                <option value="need_new_quotation">Need new quotation</option>
                <option value="budget_issue">Budget issue</option>
                <option value="competitor">Competitor</option>
              </select>
              <textarea className={calcStyles.formControl} rows={2} placeholder="Feedback" value={respForm.feedback} onChange={(e) => setRespForm((f) => ({ ...f, feedback: e.target.value }))} style={{ marginBottom: 6 }} />
              <button type="submit" className={calcStyles.btn} disabled={busySection === 'response'}>
                {busySection === 'response' ? 'Saving…' : 'Log response'}
              </button>
            </form>
          </div>

          <div className={historyStyles.miniCard}>
            <div className={historyStyles.miniCardTitle}>Negotiation history ({negotiations.length})</div>
            {negotiations.length === 0 ? (
              <div className={historyStyles.miniCardEmpty}>No negotiation entries yet.</div>
            ) : (
              negotiations.map((n) => (
                <div key={n.id} className={historyStyles.miniCardRow} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span>{formatDate(n.discussion_date)} — {n.person}: {n.discussion || n.offer_given || '-'}</span>
                  {isPrivileged && (
                    <button type="button" className={historyStyles.deleteBtn} onClick={() => handleDeleteNegotiation(n.id)}>Delete</button>
                  )}
                </div>
              ))
            )}
            <form onSubmit={handleAddNegotiation} style={{ marginTop: 10 }}>
              <div className={`${calcStyles.row} ${calcStyles.columns}`} style={{ marginBottom: 6 }}>
                <input type="date" className={calcStyles.formControl} value={negForm.discussionDate} onChange={(e) => setNegForm((f) => ({ ...f, discussionDate: e.target.value }))} />
                <input className={calcStyles.formControl} placeholder="Person" value={negForm.person} onChange={(e) => setNegForm((f) => ({ ...f, person: e.target.value }))} />
              </div>
              <textarea className={calcStyles.formControl} rows={2} placeholder="Discussion" value={negForm.discussion} onChange={(e) => setNegForm((f) => ({ ...f, discussion: e.target.value }))} style={{ marginBottom: 6 }} />
              <div className={`${calcStyles.row} ${calcStyles.columns}`} style={{ marginBottom: 6 }}>
                <input className={calcStyles.formControl} placeholder="Offer given" value={negForm.offerGiven} onChange={(e) => setNegForm((f) => ({ ...f, offerGiven: e.target.value }))} />
                <input className={calcStyles.formControl} placeholder="Discount" value={negForm.discount} onChange={(e) => setNegForm((f) => ({ ...f, discount: e.target.value }))} />
              </div>
              <div className={`${calcStyles.row} ${calcStyles.columns}`} style={{ marginBottom: 6 }}>
                <input type="number" className={calcStyles.formControl} placeholder="Revised price" value={negForm.revisedPrice} onChange={(e) => setNegForm((f) => ({ ...f, revisedPrice: e.target.value }))} />
                <input type="date" className={calcStyles.formControl} placeholder="Expected closure" value={negForm.expectedClosure} onChange={(e) => setNegForm((f) => ({ ...f, expectedClosure: e.target.value }))} />
              </div>
              <button type="submit" className={calcStyles.btn} disabled={busySection === 'negotiation'}>
                {busySection === 'negotiation' ? 'Saving…' : 'Log discussion'}
              </button>
            </form>
          </div>

          <div className={historyStyles.miniCard}>
            <div className={historyStyles.miniCardTitle}>Purchase Orders ({purchaseOrders.length})</div>
            {purchaseOrders.length === 0 ? (
              <div className={historyStyles.miniCardEmpty}>No PO received yet.</div>
            ) : (
              purchaseOrders.map((po) => (
                <div key={po.id} className={historyStyles.miniCardRow} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span>{po.po_number} — ₹{po.amount.toLocaleString('en-IN')} ({formatDate(po.po_date)})</span>
                  {isPrivileged && (
                    <button type="button" className={historyStyles.deleteBtn} onClick={() => handleDeletePo(po.id)}>Delete</button>
                  )}
                </div>
              ))
            )}
            <form onSubmit={handleAddPo} style={{ marginTop: 10 }}>
              <div className={`${calcStyles.row} ${calcStyles.columns}`} style={{ marginBottom: 6 }}>
                <input className={calcStyles.formControl} placeholder="PO number" value={poForm.poNumber} onChange={(e) => setPoForm((f) => ({ ...f, poNumber: e.target.value }))} />
                <input type="date" className={calcStyles.formControl} value={poForm.poDate} onChange={(e) => setPoForm((f) => ({ ...f, poDate: e.target.value }))} />
              </div>
              <div className={`${calcStyles.row} ${calcStyles.columns}`} style={{ marginBottom: 6 }}>
                <input type="number" className={calcStyles.formControl} placeholder="Amount" value={poForm.amount} onChange={(e) => setPoForm((f) => ({ ...f, amount: e.target.value }))} />
                <input type="number" className={calcStyles.formControl} placeholder="Advance received" value={poForm.advanceReceived} onChange={(e) => setPoForm((f) => ({ ...f, advanceReceived: e.target.value }))} />
              </div>
              <input className={calcStyles.formControl} placeholder="Payment terms" value={poForm.paymentTerms} onChange={(e) => setPoForm((f) => ({ ...f, paymentTerms: e.target.value }))} style={{ marginBottom: 6 }} />
              <button type="submit" className={calcStyles.btn} disabled={busySection === 'po'}>
                {busySection === 'po' ? 'Saving…' : 'Log PO'}
              </button>
            </form>
          </div>

          <div className={historyStyles.miniCard}>
            <div className={historyStyles.miniCardTitle}>Installation ({installations.length})</div>
            {installations.length === 0 ? (
              <div className={historyStyles.miniCardEmpty}>Not scheduled yet.</div>
            ) : (
              installations.map((inst) => (
                <div key={inst.id} className={historyStyles.miniCardRow}>
                  <div>{formatDate(inst.installation_date)} — {inst.assigned_engineer || 'Unassigned'}</div>
                  <select className={calcStyles.formControl} value={inst.status} onChange={(e) => handleInstallationStatus(inst.id, e.target.value as InstallationRecord['status'])} style={{ marginTop: 4 }}>
                    <option value="scheduled">Scheduled</option>
                    <option value="in_progress">In Progress</option>
                    <option value="completed">Completed</option>
                  </select>
                </div>
              ))
            )}
            <form onSubmit={handleAddInstallation} style={{ marginTop: 10 }}>
              <div className={`${calcStyles.row} ${calcStyles.columns}`} style={{ marginBottom: 6 }}>
                <input type="date" className={calcStyles.formControl} value={instForm.installationDate} onChange={(e) => setInstForm((f) => ({ ...f, installationDate: e.target.value }))} />
                <input className={calcStyles.formControl} placeholder="Assigned engineer" value={instForm.assignedEngineer} onChange={(e) => setInstForm((f) => ({ ...f, assignedEngineer: e.target.value }))} />
              </div>
              <button type="submit" className={calcStyles.btn} disabled={busySection === 'installation'}>
                {busySection === 'installation' ? 'Saving…' : 'Schedule installation'}
              </button>
            </form>
          </div>

          <div className={historyStyles.miniCard}>
            <div className={historyStyles.miniCardTitle}>Payment</div>
            <div className={historyStyles.miniCardRow}>PO total: ₹{totalPoAmount.toLocaleString('en-IN')}</div>
            <div className={historyStyles.miniCardRow}>Advance received: ₹{totalAdvance.toLocaleString('en-IN')}</div>
            <div className={historyStyles.miniCardRow}>Balance due: ₹{Math.max(0, totalPoAmount - totalAdvance).toLocaleString('en-IN')}</div>
          </div>
        </div>

        <h2 className={calcStyles.h2}>Activity Timeline</h2>
        <form onSubmit={handleAddRemark} className={historyStyles.followUpForm} style={{ marginBottom: 14 }}>
          <input type="text" placeholder="Add a remark to this project's timeline…" value={remarkText} onChange={(e) => setRemarkText(e.target.value)} />
          <button type="submit" disabled={savingRemark}>{savingRemark ? 'Saving…' : 'Add remark'}</button>
        </form>
        <div className={historyStyles.timeline}>
          {project.timeline
            .slice()
            .reverse()
            .map((t) => (
              <div key={t.id} className={historyStyles.timelineEntry}>
                <div className={historyStyles.timelineMeta}>
                  {formatDateTime(t.at)} · {t.by} · {STAGE_LABEL[t.stage as ProjectStage] || 'Created'}
                </div>
                <div>{t.label}</div>
                {t.remarks && <div className={calcStyles.small}>{t.remarks}</div>}
              </div>
            ))}
        </div>
      </main>
    </div>
  );
}
