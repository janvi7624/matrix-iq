'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { FolderKanban } from 'lucide-react';
import { ProjectPriority, ProjectRecord, ProjectStage, ProjectStatus, UserRole } from '@/lib/types';
import { closingProbabilityStyle, FORWARD_STAGES, STAGE_LABEL, stageProgressPercent } from '@/lib/projectStages';
import PhoneInput from '@/components/ui/PhoneInput';
import { exportListToPdf } from '@/lib/exportPdf';
import { isTechnicalRole } from '@/lib/technicalRoles';
import AppShell from './AppShell';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import { useToast } from './ui/ToastProvider';
import { todayDateInputValue, closingDatePresetRange, ClosingDatePreset } from '@/lib/dateHelpers';
import StatTile from './ui/StatTile';
import { useConfirm } from './ui/ConfirmDialog';
import { SkeletonRows } from './ui/Skeleton';
import EmptyState from './ui/EmptyState';
import ErrorState from './ui/ErrorState';
import StatusBadge from './ui/StatusBadge';
import { Field, FieldRow } from './ui/Field';
import Input from './ui/Input';
import Select from './ui/Select';
import Textarea from './ui/Textarea';
import SubmitButton from './ui/SubmitButton';
import FilterBar from './ui/FilterBar';
import ToolbarButton from './ui/ToolbarButton';
import Table, { TableColumn } from './ui/Table';
import ProjectSourceField from './ui/ProjectSourceField';

const EMPTY_FORM = {
  clientName: '',
  company: '',
  contactPerson: '',
  altContactPhone: '',
  phone: '',
  email: '',
  address: '',
  salesPersonId: '',
  source: '',
  priority: 'medium' as ProjectPriority,
  expectedClosingDate: '',
  remarks: '',
  closingProbabilityPercent: '',
  approxPrice: ''
};

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

function formatMoney(value: number | ''): string {
  if (value === '' || value === null || value === undefined) return '-';
  return `₹${value.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function formatDateTime(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('en-IN');
  } catch {
    return iso;
  }
}

interface ProjectsViewProps {
  currentUser: { username: string; role: UserRole; isPrivileged: boolean };
}

export default function ProjectsView({ currentUser }: ProjectsViewProps) {
  const toast = useToast();
  const confirm = useConfirm();
  // Role Management's isPrivileged flag, resolved server-side — NOT
  // re-derived from role name, since an admin can toggle a role's
  // privileged status independently of what the role is called.
  const isPrivileged = currentUser.isPrivileged;
  const isSuperAdmin = currentUser.role === 'superadmin';
  // Technical staff may create a project when needed, but always FOR a sales
  // person, who then owns it — same rule as POST /api/projects (a technical
  // role that's also privileged keeps the privileged path).
  const isTechnicalCreator = !isPrivileged && isTechnicalRole(currentUser.role);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState('Loading...');
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [assignableUsers, setAssignableUsers] = useState<{ id: string; username: string; name: string }[]>([]);

  useEffect(() => {
    if (!isPrivileged && !isTechnicalCreator) return;
    // Privileged: anyone (defaults to self). Technical creator: the sales
    // team only, since the project must be owned by a sales person.
    fetch(isTechnicalCreator ? '/api/users/list?scope=sales' : '/api/users/list')
      .then((r) => (r.ok ? r.json() : []))
      .then((users: { id: string; username: string; name: string }[]) => setAssignableUsers(users))
      .catch(() => setAssignableUsers([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [fSalesPerson, setFSalesPerson] = useState('');
  const [fSource, setFSource] = useState('');
  const [fStage, setFStage] = useState<ProjectStage | ''>('');
  const [fStatus, setFStatus] = useState<ProjectStatus | ''>('');
  const [fPriority, setFPriority] = useState<ProjectPriority | ''>('');
  const [fFrom, setFFrom] = useState('');
  const [fTo, setFTo] = useState('');
  const [fSearch, setFSearch] = useState('');
  const [fClosingPreset, setFClosingPreset] = useState<ClosingDatePreset>('all');
  const [fClosingFrom, setFClosingFrom] = useState('');
  const [fClosingTo, setFClosingTo] = useState('');
  // 'pending_confirmation' | '' — driven by Dashboard's "Projects awaiting
  // your confirmation" attention item linking to ?filter=pending_confirmation,
  // read once on mount rather than via useSearchParams() (which would force
  // this whole view behind a Suspense boundary just for one-time deep-link
  // support).
  const [fConfirmation, setFConfirmation] = useState(() => {
    if (typeof window === 'undefined') return '';
    const params = new URLSearchParams(window.location.search);
    return params.get('filter') === 'pending_confirmation' ? 'pending_confirmation' : '';
  });

  async function load() {
    setStatus('Loading...');
    setLoading(true);
    setLoadFailed(false);
    try {
      const response = await fetch('/api/projects');
      if (!response.ok) throw new Error(String(response.status));
      const data: ProjectRecord[] = await response.json();
      setProjects(data);
      setStatus(data.length ? `${data.length} project${data.length === 1 ? '' : 's'} found.` : '');
      setLoaded(true);
    } catch {
      setStatus('Could not reach the projects API. Try refreshing.');
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const salesPeople = useMemo(() => Array.from(new Set(projects.map((p) => p.sales_person).filter(Boolean))).sort(), [projects]);
  const sources = useMemo(() => Array.from(new Set(projects.map((p) => p.source).filter(Boolean))).sort(), [projects]);

  // Custom Range reveals its own two date inputs; every other preset
  // resolves to a fixed [from, to] window computed once per render (cheap —
  // plain Date arithmetic, no fetch).
  const closingRange = useMemo(
    () => (fClosingPreset === 'custom' ? { from: fClosingFrom, to: fClosingTo } : closingDatePresetRange(fClosingPreset)),
    [fClosingPreset, fClosingFrom, fClosingTo]
  );

  const filtered = useMemo(() => {
    const q = fSearch.trim().toLowerCase();
    return projects.filter((p) => {
      if (fSalesPerson && p.sales_person !== fSalesPerson) return false;
      if (fSource && p.source !== fSource) return false;
      if (fStage && p.stage !== fStage) return false;
      if (fStatus && p.status !== fStatus) return false;
      if (fPriority && p.priority !== fPriority) return false;
      if (fFrom && p.created_at.slice(0, 10) < fFrom) return false;
      if (fTo && p.created_at.slice(0, 10) > fTo) return false;
      if (fConfirmation && p.lead_confirmation_status !== fConfirmation) return false;
      if ((closingRange.from || closingRange.to) && !p.expected_closing_date) return false;
      if (closingRange.from && p.expected_closing_date < closingRange.from) return false;
      if (closingRange.to && p.expected_closing_date > closingRange.to) return false;
      if (q && ![p.id, p.client_name, p.company, p.contact_person].some((v) => (v || '').toLowerCase().includes(q))) return false;
      return true;
    });
  }, [projects, fSalesPerson, fSource, fStage, fStatus, fPriority, fFrom, fTo, fSearch, fConfirmation, closingRange]);

  // KPI tiles (Part 1.3) — deliberately derived from `filtered`, never
  // `projects`, so they can never show a stale count against the visible
  // table the way a separately-fetched/separately-computed KPI could.
  const dashboardKpis = useMemo(() => {
    const won = filtered.filter((p) => p.status === 'won').length;
    const lost = filtered.filter((p) => p.status === 'lost').length;
    const active = filtered.filter((p) => p.status === 'active').length;
    const totalValue = filtered.reduce((sum, p) => sum + (typeof p.approx_price === 'number' ? p.approx_price : 0), 0);
    return { total: filtered.length, won, lost, active, totalValue };
  }, [filtered]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!form.clientName.trim() && !form.company.trim()) {
      toast.error('Client name or company is required.');
      return;
    }
    if (!form.source.trim()) {
      toast.error('Source is required.');
      return;
    }
    const priceNum = Number(form.approxPrice);
    if (!form.approxPrice.trim() || !Number.isFinite(priceNum) || priceNum <= 0) {
      toast.error('Approx. Project Price is required and must be a positive number.');
      return;
    }
    if (isTechnicalCreator && !form.salesPersonId) {
      toast.error('Select the sales person this project is for.');
      return;
    }
    setCreating(true);
    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error(body?.error || 'Could not create this project. Please try again.');
        return;
      }
      // `warning`: created, but the technical creator couldn't be added as
      // its technical person — say so rather than claim they were.
      if (body?.warning) {
        toast.error(body.warning);
      } else if (isTechnicalCreator) {
        const salesPerson = assignableUsers.find((u) => u.id === form.salesPersonId);
        toast.success(`Project created for ${salesPerson ? salesPerson.name || salesPerson.username : 'the sales person'} — you're its technical person.`);
      }
      setForm(EMPTY_FORM);
      setShowForm(false);
      await load();
    } catch {
      toast.error('Could not create this project. Please try again.');
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    if (!(await confirm({ message: 'Delete this project? This cannot be undone.', danger: true }))) return;
    try {
      const response = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(String(response.status));
      setProjects((prev) => prev.filter((p) => p.id !== id));
    } catch {
      toast.error('Could not delete this project.');
    }
  }

  function handleExportPdf() {
    exportListToPdf(
      'Project Dashboard',
      ['Client', 'Company', 'Sales Person', 'Source', 'Approx. Price', 'Stage', 'Status', 'Priority', 'Last Updated', 'Next Follow-up', 'Closing %'],
      filtered.map((p) => [p.client_name, p.company, p.sales_person, p.source || '-', formatMoney(p.approx_price), STAGE_LABEL[p.stage], STATUS_LABEL[p.status], PRIORITY_LABEL[p.priority], formatDateTime(p.updated_at), formatDate(p.next_follow_up_date), p.closing_probability_percent === '' ? '-' : `${p.closing_probability_percent}%`]),
      `projects-${new Date().toISOString().slice(0, 10)}.pdf`
    );
  }

  const columns: TableColumn<ProjectRecord>[] = [
    {
      key: 'client',
      header: 'Client',
      headerClassName: historyStyles.colClient,
      render: (p) => (
        <>
          {p.client_name || p.company || '-'}
          {p.company && p.client_name ? ` (${p.company})` : ''}
        </>
      )
    },
    { key: 'salesPerson', header: 'Sales Person', headerClassName: historyStyles.colSalesPerson, render: (p) => p.sales_person },
    { key: 'source', header: 'Source', headerClassName: historyStyles.colSource, render: (p) => p.source || '-' },
    { key: 'approxPrice', header: 'Approx. Price', headerClassName: historyStyles.colApproxPrice, render: (p) => formatMoney(p.approx_price) },
    { key: 'stage', header: 'Stage', headerClassName: historyStyles.colStage, render: (p) => STAGE_LABEL[p.stage] },
    {
      key: 'status',
      header: 'Status',
      headerClassName: historyStyles.colStatus,
      render: (p) =>
        p.status === 'won' || p.status === 'lost' ? (
          <StatusBadge tone={p.status} label={p.status === 'lost' ? 'Closed Lost' : STATUS_LABEL[p.status]} />
        ) : (
          STATUS_LABEL[p.status]
        )
    },
    {
      key: 'confirmation',
      header: 'Confirmation',
      headerClassName: historyStyles.colConfirmation,
      render: (p) =>
        p.lead_confirmation_status === 'pending_confirmation' ? (
          <StatusBadge tone="pending" label="Pending Confirmation" />
        ) : p.lead_confirmation_status === 'confirmed' ? (
          <StatusBadge tone="confirmed" label="Confirmed" />
        ) : (
          '-'
        )
    },
    { key: 'updated', header: 'Last Updated', headerClassName: historyStyles.colUpdated, render: (p) => formatDateTime(p.updated_at) },
    { key: 'nextFollowUp', header: 'Next Follow-up', headerClassName: historyStyles.colNextFollowUp, render: (p) => formatDate(p.next_follow_up_date) },
    {
      key: 'closingProbability',
      header: 'Closing %',
      headerClassName: historyStyles.colClosingPct,
      render: (p) => {
        const tone = closingProbabilityStyle(p.closing_probability_percent);
        return tone ? <span className={historyStyles.closingBadge} style={tone}>{p.closing_probability_percent}%</span> : '-';
      }
    },
    {
      key: 'lastRemark',
      header: 'Last Remark',
      headerClassName: historyStyles.colLastRemark,
      // Wraps onto multiple lines within its fixed-width column instead of
      // .truncateCell's single-line ellipsis — the row grows taller for a
      // long remark rather than the column growing wider, matching how
      // every other column in this table now behaves.
      render: (p) =>
        p.last_remark ? (
          <span title={`${p.last_remark_by}, ${formatDateTime(p.last_remark_at)}`}>{p.last_remark}</span>
        ) : (
          <span className={historyStyles.mutedInline}>No remarks yet</span>
        )
    },
    {
      key: 'progress',
      header: 'Progress',
      headerClassName: historyStyles.colProgress,
      render: (p) => (
        <>
          <div className={historyStyles.progressTrack}>
            <div
              className={`${historyStyles.progressFill} ${p.status === 'lost' ? historyStyles.progressFillLost : p.status === 'won' ? historyStyles.progressFillWon : historyStyles.progressFillActive}`}
              style={{ width: `${p.status === 'lost' || p.status === 'won' ? 100 : stageProgressPercent(p.stage)}%` }}
            />
          </div>
          <div className={historyStyles.progressLabel}>
            {p.status === 'lost' ? 'Closed Lost' : p.status === 'won' ? 'Won' : `${stageProgressPercent(p.stage)}%`}
          </div>
        </>
      )
    },
    {
      key: 'actions',
      header: '',
      headerClassName: historyStyles.colActions,
      cellClassName: historyStyles.rowActionsInline,
      render: (p) => (
        <>
          <Link className={historyStyles.button} href={`/projects/${p.id}`}>
            View
          </Link>
          {isSuperAdmin && (
            <button type="button" className={historyStyles.deleteBtn} onClick={() => handleDelete(p.id)}>
              Delete
            </button>
          )}
        </>
      )
    }
  ];

  return (
    <AppShell title="Project Dashboard" subtitle="Every sales project, site visit to close, in one pipeline.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 18 }}>
          <StatTile label="Total (filtered)" value={dashboardKpis.total} />
          <StatTile label="Active" value={dashboardKpis.active} tone="info" />
          <StatTile label="Won" value={dashboardKpis.won} tone="success" />
          <StatTile label="Lost" value={dashboardKpis.lost} tone="danger" />
          <StatTile label="Total Value" value={formatMoney(dashboardKpis.totalValue)} tone="brand" />
        </div>

        <div className={historyStyles.actionRow}>
          <button type="button" className={calcStyles.btn} onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : '+ New Project'}
          </button>
          <ToolbarButton onClick={handleExportPdf}>
            Export PDF
          </ToolbarButton>
          <ToolbarButton onClick={() => window.print()}>
            Print
          </ToolbarButton>
          <ToolbarButton onClick={load}>
            Refresh
          </ToolbarButton>
        </div>

        {showForm && (
          <form className={`${calcStyles.sectionPanel} ${calcStyles.sectionPanelSpaced}`} onSubmit={handleCreate}>
            <FieldRow>
              <Field label="Client Representative Name">
                <Input value={form.clientName} onChange={(e) => setForm((f) => ({ ...f, clientName: e.target.value }))} />
              </Field>
              <Field label="Company">
                <Input value={form.company} onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))} />
              </Field>
            </FieldRow>
            <FieldRow>
              <Field label="Phone">
                <PhoneInput value={form.phone} onChange={(v) => setForm((f) => ({ ...f, phone: v }))} />
              </Field>
              <Field label="Email">
                <Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
              </Field>
              <Field label="Address">
                <Input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
              </Field>
            </FieldRow>
            <FieldRow>
              <Field label="Alternate Contact Name (optional)">
                <Input value={form.contactPerson} onChange={(e) => setForm((f) => ({ ...f, contactPerson: e.target.value }))} />
              </Field>
              <Field label="Alternate Contact Phone (optional)">
                <PhoneInput value={form.altContactPhone} onChange={(v) => setForm((f) => ({ ...f, altContactPhone: v }))} />
              </Field>
            </FieldRow>
            <FieldRow>
              {isPrivileged && (
                <Field label="Sales person">
                  <Select value={form.salesPersonId} onChange={(e) => setForm((f) => ({ ...f, salesPersonId: e.target.value }))}>
                    <option value="">Defaults to you</option>
                    {assignableUsers.map((u) => (
                      <option key={u.id} value={u.id}>{u.name || u.username}</option>
                    ))}
                  </Select>
                </Field>
              )}
              {isTechnicalCreator && (
                <Field label="Sales person *">
                  <Select required value={form.salesPersonId} onChange={(e) => setForm((f) => ({ ...f, salesPersonId: e.target.value }))}>
                    <option value="">Select the sales person</option>
                    {assignableUsers.map((u) => (
                      <option key={u.id} value={u.id}>{u.name || u.username}</option>
                    ))}
                  </Select>
                  <span className={calcStyles.lockedHint}>The project will be theirs — you&apos;ll be added as its technical person.</span>
                </Field>
              )}
              <Field label="Source *">
                <ProjectSourceField required value={form.source} onChange={(v) => setForm((f) => ({ ...f, source: v }))} />
              </Field>
              <Field label="Priority">
                <Select value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as ProjectPriority }))}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </Select>
              </Field>
              <Field label="Expected closing date">
                <Input type="date" min={todayDateInputValue()} value={form.expectedClosingDate} onChange={(e) => setForm((f) => ({ ...f, expectedClosingDate: e.target.value }))} />
              </Field>
              <Field label="Approx. Project Price (₹) *">
                <Input
                  type="number"
                  min={1}
                  step="0.01"
                  placeholder="e.g. 1250000"
                  value={form.approxPrice}
                  onChange={(e) => setForm((f) => ({ ...f, approxPrice: e.target.value }))}
                />
              </Field>
              <Field label="Closing Probability % (optional)">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  placeholder="Your estimate, e.g. 70"
                  value={form.closingProbabilityPercent}
                  onChange={(e) => setForm((f) => ({ ...f, closingProbabilityPercent: e.target.value }))}
                />
              </Field>
            </FieldRow>
            <Field label="Remarks">
              <Textarea rows={2} value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} />
            </Field>
            <SubmitButton disabled={creating}>{creating ? 'Creating…' : 'Create project'}</SubmitButton>
          </form>
        )}

        <FilterBar>
          <input type="text" placeholder="Search client, company, project ID…" value={fSearch} onChange={(e) => setFSearch(e.target.value)} />
          {isPrivileged && (
            <Select auto value={fSalesPerson} onChange={(e) => setFSalesPerson(e.target.value)}>
              <option value="">All sales people</option>
              {salesPeople.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
          )}
          <Select auto value={fSource} onChange={(e) => setFSource(e.target.value)}>
            <option value="">All sources</option>
            {sources.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </Select>
          <Select auto value={fStage} onChange={(e) => setFStage(e.target.value as ProjectStage | '')}>
            <option value="">All stages</option>
            {FORWARD_STAGES.concat('closed_lost').map((s) => (
              <option key={s} value={s}>{STAGE_LABEL[s]}</option>
            ))}
          </Select>
          <Select auto value={fStatus} onChange={(e) => setFStatus(e.target.value as ProjectStatus | '')}>
            <option value="">All statuses</option>
            {(Object.keys(STATUS_LABEL) as ProjectStatus[]).map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </Select>
          <Select auto value={fPriority} onChange={(e) => setFPriority(e.target.value as ProjectPriority | '')}>
            <option value="">All priorities</option>
            {(Object.keys(PRIORITY_LABEL) as ProjectPriority[]).map((p) => (
              <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
            ))}
          </Select>
          <Input auto type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} />
          <Input auto type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} />
          <Select auto value={fClosingPreset} onChange={(e) => setFClosingPreset(e.target.value as ClosingDatePreset)}>
            <option value="all">Closing Date: All</option>
            <option value="today">Closing Today</option>
            <option value="this_week">Closing This Week</option>
            <option value="this_month">Closing This Month</option>
            <option value="next_7">Closing Next 7 Days</option>
            <option value="next_30">Closing Next 30 Days</option>
            <option value="custom">Closing: Custom Range…</option>
          </Select>
          {fClosingPreset === 'custom' && (
            <>
              <Input auto type="date" value={fClosingFrom} onChange={(e) => setFClosingFrom(e.target.value)} />
              <Input auto type="date" value={fClosingTo} onChange={(e) => setFClosingTo(e.target.value)} />
            </>
          )}
          <Select auto value={fConfirmation} onChange={(e) => setFConfirmation(e.target.value)}>
            <option value="">All confirmations</option>
            <option value="pending_confirmation">Pending Confirmation</option>
            <option value="confirmed">Confirmed</option>
          </Select>
        </FilterBar>
        {!loading && !loadFailed && <div className={historyStyles.status}>{status}</div>}

        {loading ? (
          <div className={historyStyles.tableWrap}><SkeletonRows rows={8} columns={13} /></div>
        ) : loadFailed ? (
          <ErrorState message="Could not load projects — check your connection and try again." onRetry={load} />
        ) : (
        loaded && (
          <Table
            columns={columns}
            rows={filtered}
            rowKey={(p) => p.id}
            tableClassName={historyStyles.tableFixed}
            wrapClassName={historyStyles.tableViewport}
            empty={
              <EmptyState
                icon={FolderKanban}
                title={projects.length === 0 ? 'No projects yet' : 'No projects match your filters'}
                message={projects.length === 0 ? (isTechnicalCreator ? "Projects you're assigned to as technical lead show up here — or create one for a sales person when needed." : 'Create your first project to start tracking it through the pipeline.') : 'Try clearing a filter or search term.'}
                action={projects.length === 0 ? <button type="button" className={calcStyles.btn} onClick={() => setShowForm((v) => !v)}>+ New Project</button> : undefined}
              />
            }
          />
        )
        )}
    </AppShell>
  );
}
