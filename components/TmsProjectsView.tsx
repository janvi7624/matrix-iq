'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Layers } from 'lucide-react';
import { DepartmentRecord, TmsPriority, TmsProjectRecord, TmsProjectStatus, TmsProjectType, UserRole } from '@/lib/types';
import { TMS_DEPARTMENTS } from '@/lib/tmsConstants';
import { TMS_PRIORITY_LABEL, TMS_PRIORITY_TONE, TMS_PROJECT_STATUS_LABEL, TMS_PROJECT_STATUS_TONE, TMS_ROLE_LABEL, todayIso } from '@/lib/tmsLabels';
import AppShell from './AppShell';
import dashboardStyles from './dashboard.module.css';
import tmsDashboardStyles from './tmsDashboard.module.css';
import Modal from './ui/Modal';
import TmsGuideModal, { useTmsGuideAutoShow } from './TmsGuideModal';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import StatusBadge from './ui/StatusBadge';
import PriorityBadge from './ui/PriorityBadge';
import PersonPicker, { PersonPickerOption } from './ui/PersonPicker';
import { useToast } from './ui/ToastProvider';
import { SkeletonRows } from './ui/Skeleton';
import EmptyState from './ui/EmptyState';
import ErrorState from './ui/ErrorState';
import { Field, FieldRow } from './ui/Field';
import Input from './ui/Input';
import Select from './ui/Select';
import Textarea from './ui/Textarea';
import SubmitButton from './ui/SubmitButton';
import FilterBar from './ui/FilterBar';
import ToolbarButton from './ui/ToolbarButton';
import Table, { TableColumn } from './ui/Table';

interface PhaseDraft {
  name: string;
  description: string;
  expectedEndDate: string;
}

const EMPTY_FORM = {
  // Delivery phases planned up front. Optional — a project delivered in one
  // go simply leaves this empty, and phases can still be added later from
  // the project's own Phases tab.
  phases: [] as PhaseDraft[],
  name: '',
  clientName: '',
  clientContact: '',
  description: '',
  departmentId: '',
  projectType: 'department' as TmsProjectType,
  departmentIds: [] as string[],
  projectManagerId: '',
  teamMemberIds: [] as string[],
  startDate: '',
  estimatedCloseDate: '',
  budget: '',
  priority: 'medium' as TmsPriority,
  remarks: ''
};

function formatDate(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleDateString('en-IN');
  } catch {
    return iso;
  }
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

interface TmsProjectsViewProps {
  currentUser: { username: string; role: UserRole };
}

export default function TmsProjectsView({ currentUser }: TmsProjectsViewProps) {
  void currentUser;
  // Moved here from the old TMS Dashboard (now merged into this page) — the
  // onboarding guide needs a home since this is now the first TMS page most
  // viewers land on.
  const [autoShowGuide, dismissAutoGuide] = useTmsGuideAutoShow();
  const [showGuide, setShowGuide] = useState(false);
  const toast = useToast();
  const [projects, setProjects] = useState<TmsProjectRecord[]>([]);
  const [departments, setDepartments] = useState<DepartmentRecord[]>([]);
  const [users, setUsers] = useState<PersonPickerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [status, setStatus] = useState('Loading...');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);

  const [fDepartment, setFDepartment] = useState('');
  const [fStatus, setFStatus] = useState<TmsProjectStatus | ''>('');
  const [fPriority, setFPriority] = useState<TmsPriority | ''>('');
  const [fProjectType, setFProjectType] = useState<TmsProjectType | ''>('');
  const [fSearch, setFSearch] = useState('');
  // A user id, matched against the project manager OR the team members —
  // see the filter itself for why both.
  const [fEmployee, setFEmployee] = useState('');

  const tmsDepartments = useMemo(() => departments.filter((d) => (TMS_DEPARTMENTS as readonly string[]).includes(d.name)), [departments]);

  // Project Manager / Assign Technical Person must only offer people who
  // actually belong to the department(s) this project is for — not every
  // TMS-wide user — same reasoning as the "Other Departments Involved"
  // checkboxes right above only ever needing the department in question.
  const scopedDepartmentNames = useMemo(() => {
    const ids = form.projectType === 'combined' ? [form.departmentId, ...form.departmentIds] : [form.departmentId];
    return new Set(tmsDepartments.filter((d) => ids.includes(d.id)).map((d) => d.name));
  }, [form.departmentId, form.departmentIds, form.projectType, tmsDepartments]);

  const scopedUsers = useMemo(() => users.filter((u) => scopedDepartmentNames.has(u.department)), [users, scopedDepartmentNames]);

  // If the department selection changes (or narrows), drop any previously
  // picked manager/team members who are no longer in the newly-scoped
  // department(s) — otherwise a leftover selection from a different
  // department could silently ride along into the submitted project.
  useEffect(() => {
    const validIds = new Set(scopedUsers.map((u) => u.id));
    setForm((f) => {
      const nextManager = validIds.has(f.projectManagerId) ? f.projectManagerId : '';
      const nextTeam = f.teamMemberIds.filter((id) => validIds.has(id));
      if (nextManager === f.projectManagerId && nextTeam.length === f.teamMemberIds.length) return f;
      return { ...f, projectManagerId: nextManager, teamMemberIds: nextTeam };
    });
  }, [scopedUsers]);

  async function load() {
    setStatus('Loading...');
    setLoading(true);
    setLoadFailed(false);
    try {
      const [projectsRes, deptRes, usersRes] = await Promise.all([fetch('/api/tms/projects'), fetch('/api/departments'), fetch('/api/tms/assignable-users')]);
      if (!projectsRes.ok) throw new Error(String(projectsRes.status));
      const data: TmsProjectRecord[] = await projectsRes.json();
      setProjects(data);
      if (deptRes.ok) setDepartments(await deptRes.json());
      if (usersRes.ok) setUsers(await usersRes.json());
      setStatus(data.length ? `${data.length} project${data.length === 1 ? '' : 's'} found.` : '');
    } catch {
      setStatus('Could not reach the TMS API. Try refreshing.');
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Everyone who actually appears on a TMS project, as its manager or as a
  // team member, so the dropdown never offers a name that can only return
  // nothing.
  //
  // Built by looking ids up in the /api/tms/assignable-users list rather than
  // by zipping each record's team_member_ids against team_member_names:
  // lib/tmsProjectStore.ts builds those names with a .filter() that drops any
  // id it could not resolve, so one deactivated member makes the two arrays
  // different lengths and every name after that point pairs with the wrong id.
  const employeeOptions = useMemo(() => {
    const onProjects = new Set<string>();
    for (const p of projects) {
      if (p.project_manager_id) onProjects.add(p.project_manager_id);
      for (const id of p.team_member_ids) onProjects.add(id);
    }
    return users.filter((u) => onProjects.has(u.id)).sort((a, b) => (a.name || a.username).localeCompare(b.name || b.username));
  }, [projects, users]);

  const filtered = useMemo(() => {
    const q = fSearch.trim().toLowerCase();
    return projects.filter((p) => {
      if (fDepartment && !(p.department_names.length ? p.department_names : [p.department_name]).includes(fDepartment)) return false;
      if (fStatus && p.status !== fStatus) return false;
      if (fPriority && p.priority !== fPriority) return false;
      if (fProjectType && p.project_type !== fProjectType) return false;
      // "Vraj's projects" means the ones he is on, whichever way he is on
      // them — managing it and working on it both count. Matched on id, not
      // name, so two people sharing a name never collapse into one filter.
      if (fEmployee && p.project_manager_id !== fEmployee && !p.team_member_ids.includes(fEmployee)) return false;
      if (q && ![p.project_code, p.name, p.client_name].some((v) => (v || '').toLowerCase().includes(q))) return false;
      return true;
    });
  }, [projects, fDepartment, fStatus, fPriority, fProjectType, fEmployee, fSearch]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('Project name is required.');
      return;
    }
    if (!form.departmentId) {
      toast.error('Department is required.');
      return;
    }
    if (form.projectType === 'combined' && new Set([form.departmentId, ...form.departmentIds]).size < 2) {
      toast.error('Select at least 2 departments for a combined project.');
      return;
    }
    // A row with a date but no name is half-filled, not a phase — refusing
    // beats silently dropping it, which would look like the phase saved.
    if (form.phases.some((p) => !p.name.trim() && (p.expectedEndDate || p.description.trim()))) {
      toast.error('Give every delivery phase a name, or remove the empty row.');
      return;
    }
    setCreating(true);
    try {
      const response = await fetch('/api/tms/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, budget: Number(form.budget) || 0 })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || String(response.status));
      }
      setForm(EMPTY_FORM);
      setShowForm(false);
      await load();
      toast.success('Project created.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create this project.');
    } finally {
      setCreating(false);
    }
  }

  const columns: TableColumn<TmsProjectRecord>[] = [
    { key: 'project', header: 'Project', cellClassName: historyStyles.num, render: (p) => <>{p.project_code}<div>{p.name}</div></> },
    { key: 'client', header: 'Client', render: (p) => p.client_name || '-' },
    {
      key: 'salesHandoff',
      header: 'From Sales',
      render: (p) => (p.sales_project_id ? (
        <>
          {p.sales_person_name || '-'}
          <div>
            <Link href={`/projects/${p.sales_project_id}`} target="_blank" rel="noopener noreferrer">
              View Sales project →
            </Link>
          </div>
        </>
      ) : '-')
    },
    {
      key: 'department',
      header: 'Department',
      render: (p) => (p.project_type === 'combined' && p.department_names.length ? p.department_names.join(', ') : p.department_name)
    },
    { key: 'manager', header: 'Manager', render: (p) => p.project_manager_name || '-' },
    { key: 'engineers', header: 'Engineers', render: (p) => (p.team_member_names.length ? p.team_member_names.join(', ') : '-') },
    { key: 'status', header: 'Status', render: (p) => <StatusBadge tone={TMS_PROJECT_STATUS_TONE[p.status]} label={TMS_PROJECT_STATUS_LABEL[p.status]} /> },
    { key: 'priority', header: 'Priority', render: (p) => <PriorityBadge tone={TMS_PRIORITY_TONE[p.priority]} label={TMS_PRIORITY_LABEL[p.priority]} /> },
    {
      key: 'progress',
      header: 'Progress',
      render: (p) => (
        <>
          <div className={historyStyles.progressTrack}>
            <div className={historyStyles.progressFill} style={{ width: `${p.progress_percent}%` }} />
          </div>
          <div className={historyStyles.progressLabel}>{p.progress_percent}%</div>
        </>
      )
    },
    { key: 'estClose', header: 'Est. Close', render: (p) => formatDate(p.estimated_close_date) },
    { key: 'actions', header: '', render: (p) => <Link className={historyStyles.button} href={`/tms/projects/${p.id}`}>View</Link> }
  ];

  // Moved here from the old TMS Dashboard, now merged into this page (same
  // "stat tiles above the list" shape as the Sales Project Dashboard,
  // components/ProjectsView.tsx) — same bucket logic, computed over this
  // page's own already-loaded `projects` instead of a dashboard-wide fetch.
  // See ABSORBED_INTO_MERGED_PAGE in lib/moduleConfigStore.ts.
  const projectStats = useMemo(() => {
    const date = todayIso();
    const active = projects.filter((p) => p.status !== 'completed' && p.status !== 'cancelled');
    const completed = projects.filter((p) => p.status === 'completed');
    const nearDeadline = active.filter((p) => p.estimated_close_date && p.estimated_close_date >= date && p.estimated_close_date <= addDays(date, 7));
    const delayed = active.filter((p) => p.estimated_close_date && p.estimated_close_date < date);
    // Projects that exist but cannot actually be run yet: still in planning
    // with nobody owning them, or with no end date to be measured against.
    //
    // Most of these are not hand-created — lib/tmsHandoff.ts opens a TMS
    // project automatically the moment a technical person is assigned to a
    // Sales project, with no manager and no dates by design. They are real
    // work that nobody has set up, so they are surfaced as their own queue
    // rather than hidden (which would lose them) or left mixed into Active
    // (where they currently outnumber the runnable projects).
    const needsSetup = active.filter((p) => p.status === 'planning' && (!p.project_manager_id || (!p.deadline && !p.estimated_close_date)));
    return {
      total: projects.length,
      active: active.length, activeItems: active,
      completed: completed.length, completedItems: completed,
      nearDeadline: nearDeadline.length, nearDeadlineItems: nearDeadline,
      delayed: delayed.length, delayedItems: delayed,
      needsSetup: needsSetup.length, needsSetupItems: needsSetup
    };
  }, [projects]);

  interface DrilldownItem { id: string; label: string; sublabel: string; href: string }
  const [drilldown, setDrilldown] = useState<{ title: string; items: DrilldownItem[] } | null>(null);
  function showProjects(title: string, items: TmsProjectRecord[]) {
    setDrilldown({ title, items: items.map((p) => ({ id: p.id, label: p.name || p.client_name || p.project_code, sublabel: TMS_PROJECT_STATUS_LABEL[p.status] || p.status, href: `/tms/projects/${p.id}` })) });
  }

  // Same drilldown, but the sublabel names the missing pieces instead of
  // repeating the status — "Needs: owner, end date" tells the person what to
  // do next, which "Planning" does not.
  function showNeedsSetup(items: TmsProjectRecord[]) {
    setDrilldown({
      title: 'Projects needing setup',
      items: items.map((p) => {
        const missing: string[] = [];
        if (!p.project_manager_id) missing.push('owner');
        if (!p.deadline && !p.estimated_close_date) missing.push('end date');
        if (!p.team_member_ids.length) missing.push('team');
        return {
          id: p.id,
          label: p.name || p.client_name || p.project_code,
          sublabel: missing.length ? `Needs: ${missing.join(', ')}` : 'Ready to start',
          href: `/tms/projects/${p.id}`
        };
      })
    });
  }

  return (
    <AppShell title="Technical Projects" subtitle="Every technical project — open one for its tasks, BOM requests, procurement and activity.">
      <div className={tmsDashboardStyles.headerRow}>
        <span />
        <button type="button" onClick={() => setShowGuide(true)} className={tmsDashboardStyles.guideLink}>
          How TMS Works
        </button>
      </div>
      {(autoShowGuide || showGuide) && (
        <TmsGuideModal
          onClose={() => {
            dismissAutoGuide();
            setShowGuide(false);
          }}
        />
      )}
      <div className={dashboardStyles.kpiGrid}>
        <div className={dashboardStyles.kpiCard}>
          <div className={dashboardStyles.kpiValue}>{projectStats.total}</div>
          <div className={dashboardStyles.kpiLabel}>Total Projects</div>
        </div>
        <button type="button" className={`${dashboardStyles.kpiCard} ${dashboardStyles.kpiCardButton}`} onClick={() => showProjects('Active Projects', projectStats.activeItems)}>
          <div className={dashboardStyles.kpiValue}>{projectStats.active}</div>
          <div className={dashboardStyles.kpiLabel}>Active Projects</div>
        </button>
        <button type="button" className={`${dashboardStyles.kpiCard} ${dashboardStyles.kpiCardButton}`} onClick={() => showProjects('Completed Projects', projectStats.completedItems)}>
          <div className={dashboardStyles.kpiValue}>{projectStats.completed}</div>
          <div className={dashboardStyles.kpiLabel}>Completed Projects</div>
        </button>
        <button type="button" className={`${dashboardStyles.kpiCard} ${dashboardStyles.kpiCardAlert} ${dashboardStyles.kpiCardButton}`} onClick={() => showNeedsSetup(projectStats.needsSetupItems)}>
          <div className={dashboardStyles.kpiValue}>{projectStats.needsSetup}</div>
          <div className={dashboardStyles.kpiLabel}>Needs Setup</div>
        </button>
        <button type="button" className={`${dashboardStyles.kpiCard} ${dashboardStyles.kpiCardAlert} ${dashboardStyles.kpiCardButton}`} onClick={() => showProjects('Near Deadline', projectStats.nearDeadlineItems)}>
          <div className={dashboardStyles.kpiValue}>{projectStats.nearDeadline}</div>
          <div className={dashboardStyles.kpiLabel}>Near Deadline</div>
        </button>
        <button type="button" className={`${dashboardStyles.kpiCard} ${dashboardStyles.kpiCardAlert} ${dashboardStyles.kpiCardButton}`} onClick={() => showProjects('Delayed Projects', projectStats.delayedItems)}>
          <div className={dashboardStyles.kpiValue}>{projectStats.delayed}</div>
          <div className={dashboardStyles.kpiLabel}>Delayed Projects</div>
        </button>
      </div>

      <div className={historyStyles.actionRow}>
        {/* Hidden whenever the table is showing its empty state, because that
            state carries the New button itself — two of the same button on
            one screen is worse than none. Keyed on the FILTERED rows, not the
            full list: a bucket or filter that matches nothing still renders
            the empty state, so the header button has to stand down then too.
            Still shown once the form is open, because this same button is the
            form's Cancel and hiding it would leave no way out. */}
        {(loading || filtered.length > 0 || showForm) && (
          <button type="button" className={calcStyles.btn} onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : '+ New Project'}
          </button>
        )}
        <ToolbarButton onClick={load}>
          Refresh
        </ToolbarButton>
      </div>

      {showForm && (
        <form className={`${calcStyles.sectionPanel} ${calcStyles.sectionPanelSpaced}`} onSubmit={handleCreate}>
          <FieldRow>
            <Field label="Project name">
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
            </Field>
            <Field label="Department">
              <Select value={form.departmentId} onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))} required>
                <option value="">Select department</option>
                {tmsDepartments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Project Type">
              <Select
                value={form.projectType}
                onChange={(e) => setForm((f) => ({ ...f, projectType: e.target.value as TmsProjectType, departmentIds: e.target.value === 'department' ? [] : f.departmentIds }))}
              >
                <option value="department">Department Project</option>
                <option value="combined">Combined Project</option>
              </Select>
            </Field>
          </FieldRow>
          {form.projectType === 'combined' && (
            <Field label="Other Departments Involved">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                {tmsDepartments.filter((d) => d.id !== form.departmentId).map((d) => {
                  const checked = form.departmentIds.includes(d.id);
                  return (
                    <label key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            departmentIds: e.target.checked ? [...f.departmentIds, d.id] : f.departmentIds.filter((id) => id !== d.id)
                          }))
                        }
                      />
                      {d.name}
                    </label>
                  );
                })}
              </div>
            </Field>
          )}
          <FieldRow>
            <Field label="Project Manager / Technical Manager">
              <Select value={form.projectManagerId} onChange={(e) => setForm((f) => ({ ...f, projectManagerId: e.target.value }))} disabled={!form.departmentId}>
                <option value="">{form.departmentId ? 'Unassigned' : 'Select a department first'}</option>
                {scopedUsers.map((u) => (
                  <option key={u.id} value={u.id}>{u.name || u.username}</option>
                ))}
              </Select>
            </Field>
          </FieldRow>
          <Field label={`Assign Technical Person${form.teamMemberIds.length ? ` (${form.teamMemberIds.length} selected)` : ''}`}>
            <PersonPicker
              options={scopedUsers}
              selectedIds={form.teamMemberIds}
              onChange={(ids) => setForm((f) => ({ ...f, teamMemberIds: ids }))}
              multiple
              placeholder="Search engineer…"
              roleLabel={(role) => TMS_ROLE_LABEL[role] || role}
              emptyMessage={form.departmentId ? 'No matching active Technical Team members found in this department.' : 'Select a department first.'}
            />
          </Field>
          <FieldRow>
            <Field label="Client name">
              <Input value={form.clientName} onChange={(e) => setForm((f) => ({ ...f, clientName: e.target.value }))} />
            </Field>
            <Field label="Client contact details">
              <Input placeholder="Phone / email" value={form.clientContact} onChange={(e) => setForm((f) => ({ ...f, clientContact: e.target.value }))} />
            </Field>
            <Field label="Priority">
              <Select value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as TmsPriority }))}>
                {(Object.keys(TMS_PRIORITY_LABEL) as TmsPriority[]).map((p) => (
                  <option key={p} value={p}>{TMS_PRIORITY_LABEL[p]}</option>
                ))}
              </Select>
            </Field>
          </FieldRow>
          <FieldRow>
            <Field label="Start date">
              <Input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
            </Field>
            <Field label="Estimated close date">
              <Input type="date" value={form.estimatedCloseDate} onChange={(e) => setForm((f) => ({ ...f, estimatedCloseDate: e.target.value }))} />
            </Field>
            <Field label="Budget">
              <Input type="number" min="0" value={form.budget} onChange={(e) => setForm((f) => ({ ...f, budget: e.target.value }))} />
            </Field>
          </FieldRow>
          <Field label="Description">
            <Textarea rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </Field>
          <Field label="Notes / Remarks">
            <Textarea rows={2} value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} />
          </Field>
          <div className={calcStyles.phasePlanBox}>
            <div className={calcStyles.phasePlanHead}>
              <span className={calcStyles.label}>Delivery Phases</span>
              <ToolbarButton
                disabled={creating}
                onClick={() =>
                  setForm((f) => ({ ...f, phases: [...f.phases, { name: '', description: '', expectedEndDate: '' }] }))
                }
              >
                + Add Phase
              </ToolbarButton>
            </div>
            <div className={calcStyles.small}>
              Optional — only if this project is delivered in stages. Each phase gets its own expected end date, separate from the project deadline.
            </div>
            {form.phases.map((phase, index) => (
              <div key={index} className={calcStyles.phasePlanRow}>
                <span className={calcStyles.phasePlanIndex}>{index + 1}</span>
                <Input
                  placeholder="Phase name, e.g. Site survey"
                  value={phase.name}
                  disabled={creating}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      phases: f.phases.map((p, i) => (i === index ? { ...p, name: e.target.value } : p))
                    }))
                  }
                />
                <Input
                  auto
                  type="date"
                  value={phase.expectedEndDate}
                  disabled={creating}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      phases: f.phases.map((p, i) => (i === index ? { ...p, expectedEndDate: e.target.value } : p))
                    }))
                  }
                />
                <ToolbarButton
                  disabled={creating}
                  onClick={() => setForm((f) => ({ ...f, phases: f.phases.filter((_, i) => i !== index) }))}
                >
                  Remove
                </ToolbarButton>
              </div>
            ))}
          </div>

          <SubmitButton disabled={creating}>{creating ? 'Creating…' : 'Create project'}</SubmitButton>
        </form>
      )}

      <FilterBar>
        <input type="text" placeholder="Search project code, name, client…" value={fSearch} onChange={(e) => setFSearch(e.target.value)} />
        <Select auto value={fDepartment} onChange={(e) => setFDepartment(e.target.value)}>
          <option value="">All departments</option>
          {TMS_DEPARTMENTS.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </Select>
        <Select
          auto
          className={historyStyles.filterSelectCapped}
          value={fEmployee}
          onChange={(e) => setFEmployee(e.target.value)}
          aria-label="Filter by employee"
        >
          <option value="">All employees</option>
          {employeeOptions.map((u) => (
            // Department in the label because the same person can appear
            // across departments and this filter is most often used with the
            // department one ("AI department, and only Vraj").
            <option key={u.id} value={u.id}>{u.department ? `${u.name || u.username} — ${u.department}` : u.name || u.username}</option>
          ))}
        </Select>
        <Select auto value={fStatus} onChange={(e) => setFStatus(e.target.value as TmsProjectStatus | '')}>
          <option value="">All statuses</option>
          {(Object.keys(TMS_PROJECT_STATUS_LABEL) as TmsProjectStatus[]).map((s) => (
            <option key={s} value={s}>{TMS_PROJECT_STATUS_LABEL[s]}</option>
          ))}
        </Select>
        <Select auto value={fPriority} onChange={(e) => setFPriority(e.target.value as TmsPriority | '')}>
          <option value="">All priorities</option>
          {(Object.keys(TMS_PRIORITY_LABEL) as TmsPriority[]).map((p) => (
            <option key={p} value={p}>{TMS_PRIORITY_LABEL[p]}</option>
          ))}
        </Select>
        <Select auto value={fProjectType} onChange={(e) => setFProjectType(e.target.value as TmsProjectType | '')}>
          <option value="">All project types</option>
          <option value="department">Department Project</option>
          <option value="combined">Combined Project</option>
        </Select>
      </FilterBar>
      {!loading && !loadFailed && <div className={historyStyles.status}>{status}</div>}

      {loading ? (
        <div className={historyStyles.tableWrap}><SkeletonRows rows={8} columns={8} /></div>
      ) : loadFailed ? (
        <ErrorState message="Could not load TMS projects — check your connection and try again." onRetry={load} />
      ) : (
        <Table
          columns={columns}
          rows={filtered}
          rowKey={(p) => p.id}
          empty={
            <EmptyState
              icon={Layers}
              title={projects.length === 0 ? 'No TMS projects yet' : 'No projects match your filters'}
              message={projects.length === 0 ? 'Create your first technical project to start assigning tasks and tracking work.' : 'Try clearing a filter or search term.'}
              action={<button type="button" className={calcStyles.btn} onClick={() => setShowForm(true)}>+ New Project</button>}
            />
          }
        />
      )}

      {drilldown && (
        <Modal title={drilldown.title} ariaLabel={drilldown.title} onClose={() => setDrilldown(null)}>
          {drilldown.items.length === 0 ? (
            <p className={calcStyles.small}>Nothing in this bucket.</p>
          ) : (
            <ul className={tmsDashboardStyles.drilldownList}>
              {drilldown.items.map((item) => (
                <li key={item.id}>
                  <Link href={item.href} className={tmsDashboardStyles.drilldownRow} onClick={() => setDrilldown(null)}>
                    <span className={tmsDashboardStyles.drilldownLabel}>{item.label}</span>
                    <span className={tmsDashboardStyles.drilldownSublabel}>{item.sublabel}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}
    </AppShell>
  );
}
