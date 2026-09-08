'use client';

import { ReactNode, useEffect, useState } from 'react';
import AppShell from './AppShell';
import Table from './ui/Table';
import ToolbarButton from './ui/ToolbarButton';
import ErrorState from './ui/ErrorState';
import EmptyState from './ui/EmptyState';
import { SkeletonRows } from './ui/Skeleton';
import Modal, { ModalOkButton } from './ui/Modal';
import { useToast } from './ui/ToastProvider';
import { useConfirm } from './ui/ConfirmDialog';
import { formatMoney } from '@/lib/format';
import { STAGE_LABEL } from '@/lib/projectStages';
import { ProjectRecord, QuotationRecord } from '@/lib/types';
import calcStyles from './calculator.module.css';
import historyStyles from './quotationHistory.module.css';
import styles from './targetDetails.module.css';

interface Candidate {
  id: string;
  username: string;
  name: string;
  department: string;
  designation: string;
}

interface WorkItem {
  id: string;
  label: string;
  status: string;
}

interface QuotationItem extends WorkItem {
  total: number;
}

interface ExitSummary {
  employee: { id: string; username: string; name: string; department: string; designation: string };
  eligibleReplacements: Candidate[];
  projects: WorkItem[];
  tasks: WorkItem[];
  leads: WorkItem[];
  quotations: QuotationItem[];
}

type Assignments = Record<string, string>; // itemId -> newOwnerId

export default function EmployeeExitView() {
  const toast = useToast();
  const confirm = useConfirm();

  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [candidatesError, setCandidatesError] = useState('');
  const [selectedId, setSelectedId] = useState('');

  const [summary, setSummary] = useState<ExitSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState('');

  const [assignments, setAssignments] = useState<Assignments>({});
  const [bulkOwner, setBulkOwner] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ reassignedCounts: Record<string, number>; employeeStatus: string } | null>(null);

  // Record detail popup — "Record" only ever showed a bare label (project
  // client name / quotation number) with nothing else, so a manager had no
  // way to tell what the work actually was before choosing who to hand it
  // to. Fetches the real record on demand from the existing single-record
  // APIs (already correctly authorized for a department manager viewing
  // their own team's records — same resolveVisibilityScope check this
  // module's own candidate/summary routes use).
  const [detailTarget, setDetailTarget] = useState<{ kind: 'project' | 'quotation'; id: string } | null>(null);
  const [detailData, setDetailData] = useState<ProjectRecord | QuotationRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  function openDetail(kind: 'project' | 'quotation', id: string) {
    setDetailTarget({ kind, id });
    setDetailData(null);
    setDetailError('');
    setDetailLoading(true);
    fetch(kind === 'project' ? `/api/projects/${id}` : `/api/quotations/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((body) => setDetailData(kind === 'project' ? body.project : body))
      .catch(() => setDetailError('Could not load the full details for this record.'))
      .finally(() => setDetailLoading(false));
  }

  useEffect(() => {
    fetch('/api/employee-exit/candidates')
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((json: { candidates: Candidate[] }) => setCandidates(json.candidates))
      .catch(() => setCandidatesError('Could not load the employee list.'));
  }, []);

  function loadSummary(userId: string) {
    setSelectedId(userId);
    setSummary(null);
    setResult(null);
    setAssignments({});
    setBulkOwner('');
    if (!userId) return;
    setSummaryLoading(true);
    setSummaryError('');
    fetch(`/api/employee-exit/${encodeURIComponent(userId)}/summary`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((json: ExitSummary) => setSummary(json))
      .catch(() => setSummaryError('Could not load this employee’s assigned work.'))
      .finally(() => setSummaryLoading(false));
  }

  function applyToAll() {
    if (!summary || !bulkOwner) return;
    const next: Assignments = {};
    for (const item of [...summary.projects, ...summary.tasks, ...summary.leads, ...summary.quotations]) next[item.id] = bulkOwner;
    setAssignments(next);
  }

  const totalItems = summary ? summary.projects.length + summary.tasks.length + summary.leads.length + summary.quotations.length : 0;
  const allAssigned = summary ? Object.keys(assignments).length === totalItems && totalItems > 0 : false;

  async function handleSubmit() {
    if (!summary) return;
    const ok = await confirm({
      title: 'Confirm reassignment',
      message: `Reassign ${summary.projects.length} project(s), ${summary.tasks.length} task(s), ${summary.leads.length} lead(s), and ${summary.quotations.length} quotation(s) from ${summary.employee.name}, and mark them inactive?`,
      confirmLabel: 'Reassign & Mark Inactive',
      danger: true
    });
    if (!ok) return;

    setSubmitting(true);
    try {
      const body = {
        reassignments: {
          projects: summary.projects.map((p) => ({ id: p.id, newOwnerId: assignments[p.id] })),
          tasks: summary.tasks.map((t) => ({ id: t.id, newOwnerId: assignments[t.id] })),
          leads: summary.leads.map((l) => ({ id: l.id, newOwnerId: assignments[l.id] })),
          quotations: summary.quotations.map((q) => ({ id: q.id, newOwnerId: assignments[q.id] }))
        },
        setInactive: true
      };
      const response = await fetch(`/api/employee-exit/${encodeURIComponent(summary.employee.id)}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast.error(json.error || 'Could not complete the reassignment.');
        return;
      }
      setResult(json);
      toast.success('Employee marked inactive and work reassigned.');
    } catch {
      toast.error('Could not reach the server. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setSelectedId('');
    setSummary(null);
    setResult(null);
    setAssignments({});
  }

  function renderGroup(title: string, items: WorkItem[], kind?: 'project' | 'quotation') {
    if (!summary) return null;
    return (
      <>
        <h3 className={historyStyles.navGroupLabel}>{title} ({items.length})</h3>
        {items.length === 0 ? (
          <p className={historyStyles.small}>None.</p>
        ) : (
          <Table
            columns={[
              {
                key: 'label',
                header: 'Record',
                render: (row: WorkItem) =>
                  kind ? (
                    <button
                      type="button"
                      onClick={() => openDetail(kind, row.id)}
                      style={{ background: 'none', border: 'none', padding: 0, color: 'var(--mx-brand)', textDecoration: 'underline', cursor: 'pointer', font: 'inherit', textAlign: 'left' }}
                    >
                      {row.label}
                    </button>
                  ) : (
                    row.label
                  )
              },
              {
                key: 'amount',
                header: 'Amount',
                render: (row: WorkItem) => (typeof (row as QuotationItem).total === 'number' ? formatMoney((row as QuotationItem).total) : '—')
              },
              {
                key: 'newOwner',
                header: 'Reassign To',
                render: (row: WorkItem) => (
                  <select
                    className={calcStyles.formControl}
                    value={assignments[row.id] || ''}
                    onChange={(e) => setAssignments((prev) => ({ ...prev, [row.id]: e.target.value }))}
                  >
                    <option value="">Select…</option>
                    {summary.eligibleReplacements.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                )
              }
            ]}
            rows={items}
            rowKey={(row) => row.id}
          />
        )}
      </>
    );
  }

  return (
    <AppShell title="Employee Exit" subtitle="Reassign a departing employee's projects, tasks, leads, and quotations.">
      {candidatesError ? (
        <ErrorState message={candidatesError} />
      ) : !candidates ? (
        <SkeletonRows rows={2} columns={1} />
      ) : (
        <div className={historyStyles.toolbar}>
          <select className={calcStyles.formControl} value={selectedId} onChange={(e) => loadSummary(e.target.value)} aria-label="Employee">
            <option value="">Select an employee…</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>{c.name}{c.department ? ` (${c.department})` : ''}</option>
            ))}
          </select>
        </div>
      )}

      {candidates && candidates.length === 0 && !candidatesError && (
        <EmptyState title="No employees to manage" message="You don't currently manage any active employees other than yourself." />
      )}

      {summaryLoading && <SkeletonRows rows={4} columns={3} />}
      {summaryError && <ErrorState message={summaryError} onRetry={() => loadSummary(selectedId)} />}

      {summary && !result && (
        <>
          <h2 className={styles.tabActive} style={{ display: 'block', marginBottom: 12 }}>
            Employee: {summary.employee.name}
          </h2>

          {summary.eligibleReplacements.length === 0 ? (
            <EmptyState title="No eligible replacements" message="There are no other active employees within your scope to reassign work to." />
          ) : (
            <>
              <div className={historyStyles.toolbar}>
                <select className={calcStyles.formControl} value={bulkOwner} onChange={(e) => setBulkOwner(e.target.value)} aria-label="Reassign everything to">
                  <option value="">Reassign everything to…</option>
                  {summary.eligibleReplacements.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <ToolbarButton onClick={applyToAll} disabled={!bulkOwner}>Apply to all</ToolbarButton>
              </div>

              {totalItems === 0 ? (
                <EmptyState title="Nothing currently open" message="This employee has no open projects, tasks, leads, or quotations to reassign." />
              ) : (
                <>
                  {renderGroup('Active Projects', summary.projects, 'project')}
                  {renderGroup('Open Tasks', summary.tasks)}
                  {renderGroup('Open Leads', summary.leads)}
                  {renderGroup('Open Quotations', summary.quotations, 'quotation')}

                  <div className={historyStyles.toolbar} style={{ marginTop: 16 }}>
                    <ToolbarButton primary onClick={handleSubmit} disabled={submitting || !allAssigned}>
                      {submitting ? 'Reassigning…' : 'Reassign & Mark Inactive'}
                    </ToolbarButton>
                    {!allAssigned && <span className={historyStyles.small}>Choose a new owner for every record above before continuing.</span>}
                  </div>
                </>
              )}

              {totalItems === 0 && (
                <div className={historyStyles.toolbar} style={{ marginTop: 16 }}>
                  <ToolbarButton primary onClick={handleSubmit} disabled={submitting}>
                    {submitting ? 'Marking inactive…' : 'Mark Inactive'}
                  </ToolbarButton>
                </div>
              )}
            </>
          )}
        </>
      )}

      {result && (
        <div className={calcStyles.sectionPanel}>
          <h3 className={historyStyles.navGroupLabel}>Done</h3>
          <p>
            Reassigned {result.reassignedCounts.projects} project(s), {result.reassignedCounts.tasks} task(s), {result.reassignedCounts.leads} lead(s), and{' '}
            {result.reassignedCounts.quotations} quotation(s). Employee status is now <strong>{result.employeeStatus}</strong>.
          </p>
          <ToolbarButton onClick={reset}>Do another</ToolbarButton>
        </div>
      )}

      {detailTarget && (
        <Modal
          title={detailTarget.kind === 'project' ? 'Project Details' : 'Quotation Details'}
          ariaLabel={detailTarget.kind === 'project' ? 'Project details' : 'Quotation details'}
          onClose={() => setDetailTarget(null)}
          size="wide"
          footer={<ModalOkButton onClick={() => setDetailTarget(null)}>Close</ModalOkButton>}
        >
          {detailLoading ? (
            <SkeletonRows rows={4} columns={2} />
          ) : detailError ? (
            <ErrorState message={detailError} onRetry={() => openDetail(detailTarget.kind, detailTarget.id)} />
          ) : detailTarget.kind === 'project' ? (
            <ProjectDetailFields project={detailData as ProjectRecord} />
          ) : (
            <QuotationDetailFields quotation={detailData as QuotationRecord} />
          )}
        </Modal>
      )}
    </AppShell>
  );
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-IN');
  } catch {
    return iso;
  }
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderBottom: '1px solid var(--mx-border)' }}>
      <span style={{ color: 'var(--mx-ink-muted)', fontSize: 13 }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, textAlign: 'right' }}>{value ?? '—'}</span>
    </div>
  );
}

function ProjectDetailFields({ project }: { project: ProjectRecord | null }) {
  if (!project) return null;
  return (
    <div>
      <DetailRow label="Client" value={project.client_name || '—'} />
      <DetailRow label="Company" value={project.company || '—'} />
      <DetailRow label="Phone" value={project.phone || '—'} />
      <DetailRow label="Email" value={project.email || '—'} />
      <DetailRow label="Address" value={project.address || '—'} />
      <DetailRow label="Stage" value={STAGE_LABEL[project.stage] || project.stage} />
      <DetailRow label="Status" value={project.status} />
      <DetailRow label="Priority" value={project.priority} />
      <DetailRow label="Sales Person" value={project.sales_person || '—'} />
      <DetailRow label="Assigned Technical Person" value={project.assigned_technical_person_name || '—'} />
      <DetailRow label="Expected Closing" value={formatDate(project.expected_closing_date)} />
      <DetailRow label="Next Follow-up" value={formatDate(project.next_follow_up_date)} />
      <DetailRow label="Created" value={formatDate(project.created_at)} />
      {project.remarks && <DetailRow label="Remarks" value={project.remarks} />}
    </div>
  );
}

function QuotationDetailFields({ quotation }: { quotation: QuotationRecord | null }) {
  if (!quotation) return null;
  return (
    <div>
      <DetailRow label="Quotation No." value={quotation.quotation_number} />
      <DetailRow label="Client" value={quotation.client_name || '—'} />
      <DetailRow label="Company" value={quotation.client_company || '—'} />
      <DetailRow label="Phone" value={quotation.client_phone || '—'} />
      <DetailRow label="Email" value={quotation.client_email || '—'} />
      <DetailRow label="Status" value={quotation.status} />
      <DetailRow label="Domain" value={quotation.domain_summary || '—'} />
      <DetailRow label="Products" value={quotation.products_summary || '—'} />
      <DetailRow label="Subtotal" value={formatMoney(quotation.subtotal)} />
      <DetailRow label="Discount" value={formatMoney(quotation.discount_total)} />
      <DetailRow label="GST" value={formatMoney(quotation.gst_amount)} />
      <DetailRow label="Total" value={formatMoney(quotation.total)} />
      <DetailRow label="Validity (days)" value={quotation.validity_days} />
      <DetailRow label="Created" value={formatDate(quotation.created_at)} />
    </div>
  );
}
