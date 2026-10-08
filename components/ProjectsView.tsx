'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { FolderKanban } from 'lucide-react';
import { ProjectPriority, ProjectRecord, ProjectStage, ProjectStatus, UserRole } from '@/lib/types';
import { closingProbabilityStyle, FORWARD_STAGES, STAGE_LABEL, stageProgressPercent } from '@/lib/projectStages';
import { findClosestClient } from '@/lib/clientSimilarity';
import { CLOSED_PROJECT_HIDE_AFTER_DAYS, isAgedClosedProject } from '@/lib/projectVisibility';
import PhoneInput from '@/components/ui/PhoneInput';
import { exportListToPdf } from '@/lib/exportPdf';
import { formatMoneyCompact } from '@/lib/format';
import { isTechnicalRole } from '@/lib/technicalRoles';
import AppShell from './AppShell';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import { useToast } from './ui/ToastProvider';
import { todayDateInputValue, closingDatePresetRange, ClosingDatePreset } from '@/lib/dateHelpers';
import StatTile from './ui/StatTile';
import ProjectDetailRemindersDialog from './ProjectDetailRemindersDialog';
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
import FilterPanel, {
  ActiveFilter,
  FilterDatePair,
  FilterField,
  FilterGrid,
  FilterMeta,
  FilterPrimaryRow,
  FilterSearch,
  FilterSubRange,
  FilterToggle,
  filterPanelStyles,
} from './ui/FilterPanel';
import ToolbarButton from './ui/ToolbarButton';
import Table, { TableColumn } from './ui/Table';
import ProjectSourceField from './ui/ProjectSourceField';
import ProjectLeadField from './ui/ProjectLeadField';
import OpportunityTypeField from './ui/OpportunityTypeField';
import ProjectDepartmentField from './ui/ProjectDepartmentField';
import PersonPicker, { PersonPickerOption } from './ui/PersonPicker';
import { useProjectLeads } from './ui/useProjectLeads';
import { OPPORTUNITY_TYPES, OPPORTUNITY_TYPE_LABEL, OpportunityType, nextLeadOnTypeChange } from '@/lib/projectLeadOptions';
import ProjectIntakeFields, { EMPTY_PROJECT_INTAKE, ProjectLocationFields } from './ui/ProjectIntakeFields';
import {
  DepartmentAmounts,
  PROJECT_DEPARTMENTS,
  PROJECT_DEPARTMENT_LABEL,
  ProjectDepartment,
  ProjectDepartmentFilter,
  departmentValueOf,
  formatProjectDepartments,
  isProjectDepartment,
  matchesDepartmentFilter,
  sumDepartmentAmounts
} from '@/lib/projectDepartmentOptions';

const EMPTY_FORM = {
  clientName: '',
  company: '',
  contactPerson: '',
  altContactPhone: '',
  phone: '',
  email: '',
  address: '',
  ...EMPTY_PROJECT_INTAKE,
  salesPersonId: '',
  technicalPersonIds: [] as string[],
  projectLeadId: '',
  opportunityType: '' as OpportunityType | '',
  departments: [] as ProjectDepartment[],
  departmentAmounts: {} as DepartmentAmounts,
  source: '',
  priority: 'medium' as ProjectPriority,
  expectedClosingDate: '',
  remarks: '',
  closingProbabilityPercent: '',
  approxPrice: ''
};

const STATUS_LABEL: Record<ProjectStatus, string> = { active: 'Active', on_hold: 'On Hold', won: 'Won', lost: 'Lost' };
const PRIORITY_LABEL: Record<ProjectPriority, string> = { low: 'Low', medium: 'Medium', high: 'High' };
// Captions for the closing-date presets. The old options spelled the filter
// name into every row ("Closing Date: All", "Closing Today") because a bare
// dropdown in a flat bar had nothing else to say what it was; inside a
// captioned field the prefix is noise.
const CLOSING_PRESET_LABEL: Record<ClosingDatePreset, string> = {
  all: 'All',
  today: 'Today',
  this_week: 'This week',
  this_month: 'This month',
  next_7: 'Next 7 days',
  next_30: 'Next 30 days',
  custom: 'Custom range…',
};
const CONFIRMATION_LABEL: Record<string, string> = {
  pending_confirmation: 'Pending confirmation',
  confirmed: 'Confirmed',
};
// Search, Stage and Status live in the always-visible primary row; everything
// else sits behind the Filters toggle, so only the rest counts toward its
// badge.
const QUICK_FILTER_KEYS = new Set(['search', 'stage', 'status']);

function projectCountLabel(loading: boolean, shown: number, total: number): string {
  if (loading) return 'Loading projects…';
  if (total === 0) return 'No projects yet';
  if (shown === total) return `${total} project${total === 1 ? '' : 's'}`;
  return `Showing ${shown} of ${total} projects`;
}

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
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showReminders, setShowReminders] = useState(false);
  const [assignableUsers, setAssignableUsers] = useState<{ id: string; username: string; name: string }[]>([]);
  const [technicalRoster, setTechnicalRoster] = useState<PersonPickerOption[]>([]);
  // Last Remark used to expand on row :hover — a long remark ballooned the
  // row the instant the pointer crossed it anywhere (not just the cell), so
  // just reaching another button in that row made the layout jump. Click is
  // deliberate and stays put, so it's a plain per-row toggle instead.
  const [expandedRemarkIds, setExpandedRemarkIds] = useState<Set<string>>(new Set());
  function toggleRemarkExpanded(id: string) {
    setExpandedRemarkIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  useEffect(() => {
    if (!isPrivileged && !isTechnicalCreator) return;
    // The sales team only, for everyone — whoever is picked here OWNS the
    // project, and that has to be a sales person. An admin/manager used to
    // get the whole org in this dropdown, so picking an engineer was one
    // click away and the server took it (see app/api/projects/route.ts).
    // A privileged creator who wants the project themselves leaves it on
    // "Defaults to you".
    fetch('/api/users/list?scope=sales')
      .then((r) => (r.ok ? r.json() : []))
      .then((users: { id: string; username: string; name: string }[]) => setAssignableUsers(users))
      .catch(() => setAssignableUsers([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // A technical creator IS the project's technical person (see
    // app/api/projects/route.ts) — nobody else needs picking.
    if (isTechnicalCreator) return;
    fetch('/api/technical-roster')
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: PersonPickerOption[]) => setTechnicalRoster(rows))
      .catch(() => setTechnicalRoster([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Project Lead / Mentor filter — a user id from GET /api/projects/leads.
  // Picking a lead shows the projects they lead AND the ones they own (see
  // `filtered` below).
  const leadsLoaded = useProjectLeads();
  const leadOptions = useMemo(() => leadsLoaded ?? [], [leadsLoaded]);
  const [fLead, setFLead] = useState('');
  const [fType, setFType] = useState<OpportunityType | ''>('');
  // AI / AV / Robotics, or '' for all — see matchesDepartmentFilter in
  // lib/projectDepartmentOptions.ts.
  // Seeded from ?department= so the Dashboard's "Projects by Department"
  // card can link straight into a filtered list — read once on mount, same
  // approach (and same reason) as fConfirmation's ?filter= deep link below.
  const [fDepartment, setFDepartment] = useState<ProjectDepartmentFilter>(() => {
    if (typeof window === 'undefined') return '';
    const requested = new URLSearchParams(window.location.search).get('department') ?? '';
    return isProjectDepartment(requested) ? requested : '';
  });

  // The Opportunity Type pre-fills the Project Lead (Distribution -> Manoj,
  // Project -> Pankaj) until the person picks a lead by hand — after that the
  // type never moves it.
  const [leadTouched, setLeadTouched] = useState(false);
  function handleOpportunityTypeChange(next: OpportunityType | '') {
    setForm((f) => ({ ...f, opportunityType: next, projectLeadId: nextLeadOnTypeChange(f.projectLeadId, leadTouched, next, leadOptions) }));
  }

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
  // Nine of the fourteen filters sit behind the Filters toggle. It starts open
  // when a deep link arrived with one of those already applied (Dashboard's
  // department cards and its "awaiting your confirmation" item both do), so
  // the panel never starts collapsed over a filter the user did not set.
  const [showFilters, setShowFilters] = useState(() => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    return isProjectDepartment(params.get('department') ?? '') || params.get('filter') === 'pending_confirmation';
  });

  async function load() {
    setLoading(true);
    setLoadFailed(false);
    try {
      const response = await fetch('/api/projects');
      if (!response.ok) throw new Error(String(response.status));
      const data: ProjectRecord[] = await response.json();
      setProjects(data);
      setLoaded(true);
    } catch {
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

  const selectedLead = useMemo(() => leadOptions.find((l) => l.id === fLead) ?? null, [leadOptions, fLead]);

  // One entry per filter that is actually narrowing the list, each able to
  // clear just itself. Rendered as chips under the panel, which is what makes
  // collapsing the grid safe: a filter hidden behind the toggle is still
  // visible, and still removable, as a chip.
  const activeFilters = useMemo<ActiveFilter[]>(() => {
    const out: ActiveFilter[] = [];
    if (fSearch.trim()) out.push({ key: 'search', label: 'Search', value: fSearch.trim(), clear: () => setFSearch('') });
    if (fStage) out.push({ key: 'stage', label: 'Stage', value: STAGE_LABEL[fStage], clear: () => setFStage('') });
    if (fStatus) out.push({ key: 'status', label: 'Status', value: STATUS_LABEL[fStatus], clear: () => setFStatus('') });
    if (fSalesPerson) out.push({ key: 'salesPerson', label: 'Sales person', value: fSalesPerson, clear: () => setFSalesPerson('') });
    if (fLead) out.push({ key: 'lead', label: 'Project lead', value: selectedLead?.name ?? fLead, clear: () => setFLead('') });
    if (fType) out.push({ key: 'type', label: 'Opportunity', value: OPPORTUNITY_TYPE_LABEL[fType], clear: () => setFType('') });
    if (fDepartment) out.push({ key: 'department', label: 'Department', value: PROJECT_DEPARTMENT_LABEL[fDepartment], clear: () => setFDepartment('') });
    if (fSource) out.push({ key: 'source', label: 'Source', value: fSource, clear: () => setFSource('') });
    if (fPriority) out.push({ key: 'priority', label: 'Priority', value: PRIORITY_LABEL[fPriority], clear: () => setFPriority('') });
    if (fConfirmation) out.push({ key: 'confirmation', label: 'Confirmation', value: CONFIRMATION_LABEL[fConfirmation] ?? fConfirmation, clear: () => setFConfirmation('') });
    if (fFrom || fTo) out.push({ key: 'created', label: 'Created', value: `${fFrom || 'any'} → ${fTo || 'any'}`, clear: () => { setFFrom(''); setFTo(''); } });
    if (fClosingPreset !== 'all') {
      out.push({
        key: 'closing',
        label: 'Closing',
        value: fClosingPreset === 'custom' ? `${fClosingFrom || 'any'} → ${fClosingTo || 'any'}` : CLOSING_PRESET_LABEL[fClosingPreset],
        clear: () => { setFClosingPreset('all'); setFClosingFrom(''); setFClosingTo(''); },
      });
    }
    return out;
  }, [fSearch, fStage, fStatus, fSalesPerson, fLead, selectedLead, fType, fDepartment, fSource, fPriority, fConfirmation, fFrom, fTo, fClosingPreset, fClosingFrom, fClosingTo]);

  const advancedActiveCount = activeFilters.filter((f) => !QUICK_FILTER_KEYS.has(f.key)).length;

  function clearAllFilters() {
    setFSearch('');
    setFStage('');
    setFStatus('');
    setFSalesPerson('');
    setFLead('');
    setFType('');
    setFDepartment('');
    setFSource('');
    setFPriority('');
    setFConfirmation('');
    setFFrom('');
    setFTo('');
    setFClosingPreset('all');
    setFClosingFrom('');
    setFClosingTo('');
  }

  // The two primary-row filters have no caption to tint, so they carry the
  // active class themselves.
  const quickClass = (active: boolean) => [filterPanelStyles.quick, active ? filterPanelStyles.controlActive : ''].filter(Boolean).join(' ');

  // Every filter EXCEPT status. The status tiles count off this, so picking
  // one does not zero the others — otherwise clicking "Won" would leave
  // Active/On Hold/Lost all reading 0 and there would be no way to click
  // onwards. Standard faceted-filter behaviour: each tile answers "how many
  // would I get if I picked this", which is exactly what it then shows.
  const filteredExceptStatus = useMemo(() => {
    const q = fSearch.trim().toLowerCase();
    return projects.filter((p) => {
      // Filtering by a lead shows what they LEAD plus what they OWN — a lead
      // is also a person with projects of their own, and both belong in "their"
      // view. Nothing matches until the lead options have loaded.
      if (fLead) {
        const leads = p.project_lead_id === fLead;
        const owns = !!selectedLead && (p.created_by === selectedLead.username || p.sales_person === selectedLead.username);
        if (!leads && !owns) return false;
      }
      if (fType && p.opportunity_type !== fType) return false;
      if (!matchesDepartmentFilter(p.departments, fDepartment)) return false;
      if (fSalesPerson && p.sales_person !== fSalesPerson) return false;
      if (fSource && p.source !== fSource) return false;
      if (fStage && p.stage !== fStage) return false;
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
  }, [projects, fLead, selectedLead, fType, fDepartment, fSalesPerson, fSource, fStage, fPriority, fFrom, fTo, fSearch, fConfirmation, closingRange]);

  const filtered = useMemo(() => {
    const now = new Date();
    return filteredExceptStatus.filter((p) => {
      if (fStatus) return p.status === fStatus;
      // No explicit Won/Lost pick -> a deal closed long ago drops out of the
      // default view (it was piling up alongside everything still active).
      // Picking Won or Lost still shows every one of them, however old — see
      // lib/projectVisibility.ts. Unchanged behaviour, just relocated so the
      // clause sits with the status test it depends on.
      return !isAgedClosedProject(p, now);
    });
  }, [filteredExceptStatus, fStatus]);

  // Surfaced next to the filter bar so the auto-hide above never looks like
  // data went missing — see the comment in the filter itself.
  const hiddenAgedClosedCount = useMemo(() => {
    if (fStatus) return 0;
    const now = new Date();
    return projects.filter((p) => isAgedClosedProject(p, now)).length;
  }, [projects, fStatus]);

  // KPI tiles (Part 1.3) — deliberately derived from `filtered`, never
  // `projects`, so they can never show a stale count against the visible
  // table the way a separately-fetched/separately-computed KPI could.
  const dashboardKpis = useMemo(() => {
    // Status counts come from filteredExceptStatus, so each tile shows what
    // clicking it will produce — including aged Won/Lost deals, which the
    // default view hides but a Won/Lost pick reveals. Total and Total Value
    // stay on filtered: those describe the list as it currently stands.
    const won = filteredExceptStatus.filter((p) => p.status === 'won').length;
    const lost = filteredExceptStatus.filter((p) => p.status === 'lost').length;
    const active = filteredExceptStatus.filter((p) => p.status === 'active').length;
    // The fourth ProjectStatus. Without its own tile the three above don't add
    // up to Total and an on-hold deal shows in no tile at all — it is neither
    // Active nor closed, and (unlike Won/Lost) never ages out of the list
    // either, so it would otherwise sit here indefinitely uncounted.
    const onHold = filteredExceptStatus.filter((p) => p.status === 'on_hold').length;
    // Follows the Department filter: unfiltered this is the whole 50L of an
    // AI+AV project, filtered to AI it is AI's 27L share. Same function the
    // Approx. Price column uses, so the tile can never disagree with the rows
    // adding up to it.
    const totalValue = filtered.reduce((sum, p) => sum + departmentValueOf(p, fDepartment), 0);
    return { total: filtered.length, won, lost, active, onHold, totalValue };
  }, [filtered, filteredExceptStatus, fDepartment]);

  // A live, non-blocking nudge while the New Project form is open — the
  // typed client name/company against every existing project, so a rep
  // retyping a client someone already entered (under a slightly different
  // spelling) gets a chance to open that one instead of creating a
  // duplicate. Suggestion only: it never blocks or auto-cancels the submit.
  const possibleDuplicate = useMemo(
    () => (showForm
      ? findClosestClient(form.clientName, form.company, projects.map((p) => ({ id: p.id, clientName: p.client_name, company: p.company })))
      : null),
    [showForm, form.clientName, form.company, projects]
  );

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
    if (!form.opportunityType) {
      toast.error('Opportunity Type is required.');
      return;
    }
    if (!form.projectLeadId) {
      toast.error('Project Lead / Mentor is required.');
      return;
    }
    if (form.departments.length > 1 && form.departments.some((d) => !form.departmentAmounts[d])) {
      toast.error('Enter an approx. value for each department on a multi-department project.');
      return;
    }
    if (!form.departments.length) {
      toast.error('Department is required — AI, AV, Robotics, or a combination.');
      return;
    }
    if (!isTechnicalCreator && !form.technicalPersonIds.length) {
      toast.error('Technical Person is required — pick at least one.');
      return;
    }
    setCreating(true);
    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, assignedTechnicalPersonIds: form.technicalPersonIds })
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
      } else if (form.technicalPersonIds.length) {
        const names = form.technicalPersonIds.map((id) => technicalRoster.find((p) => p.id === id)?.name).filter(Boolean);
        toast.success(`Project created — pending approval of ${names.join(', ') || 'the technical person'}.`);
      }
      setForm(EMPTY_FORM);
      setLeadTouched(false);
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
      ['Client', 'Company', 'Sales Person', 'Department', 'Project Lead', 'Source', 'Approx. Price', 'Stage', 'Status', 'Priority', 'Last Updated', 'Next Follow-up', 'Closing %'],
      filtered.map((p) => [p.client_name, p.company, p.sales_person, formatProjectDepartments(p.departments), p.project_lead_name ? `${p.project_lead_name}${p.opportunity_type ? ` (${OPPORTUNITY_TYPE_LABEL[p.opportunity_type]})` : ''}` : '-', p.source || '-', formatMoney(p.approx_price), STAGE_LABEL[p.stage], STATUS_LABEL[p.status], PRIORITY_LABEL[p.priority], formatDateTime(p.updated_at), formatDate(p.next_follow_up_date), p.closing_probability_percent === '' ? '-' : `${p.closing_probability_percent}%`]),
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
    { key: 'department', header: 'Department', headerClassName: historyStyles.colDepartment, render: (p) => formatProjectDepartments(p.departments) },
    {
      key: 'projectLead',
      header: 'Project Lead',
      headerClassName: historyStyles.colProjectLead,
      render: (p) => (
        <>
          {p.project_lead_name || '-'}
          {p.opportunity_type && <div className={historyStyles.mutedInline}>{OPPORTUNITY_TYPE_LABEL[p.opportunity_type]}</div>}
        </>
      )
    },
    { key: 'source', header: 'Source', headerClassName: historyStyles.colSource, render: (p) => p.source || '-' },
    {
      key: 'approxPrice',
      // Header names what is actually being shown: filtering to AI turns this
      // column into AI's share, not the project's full value, so the rows add
      // up to the Total Value tile above them.
      header: fDepartment ? `${PROJECT_DEPARTMENT_LABEL[fDepartment]} Value` : 'Approx. Price',
      headerClassName: historyStyles.colApproxPrice,
      render: (p) => (
        <>
          {formatMoney(departmentValueOf(p, fDepartment))}
          {/* On a split project the full value stays visible, so a filtered
              view never looks like the deal shrank. */}
          {fDepartment && (p.departments?.length ?? 0) > 1 && (
            <div className={historyStyles.mutedInline}>of {formatMoney(p.approx_price)}</div>
          )}
        </>
      )
    },
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
          <div className={historyStyles.wrapBadge}><StatusBadge tone="pending" label="Pending Confirmation" /></div>
        ) : p.lead_confirmation_status === 'confirmed' ? (
          <div className={historyStyles.wrapBadge}><StatusBadge tone="confirmed" label="Confirmed" /></div>
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
      // every other column in this table now behaves. Click toggles the full
      // text open/closed (see expandedRemarkIds above) — no longer hover.
      render: (p) =>
        p.last_remark ? (
          <button
            type="button"
            className={`${historyStyles.remarkClamp} ${expandedRemarkIds.has(p.id) ? historyStyles.remarkClampExpanded : ''}`}
            onClick={() => toggleRemarkExpanded(p.id)}
            title={`${p.last_remark_by}, ${formatDateTime(p.last_remark_at)}`}
          >
            {p.last_remark}
          </button>
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
          {/* Each status tile is the Status filter: clicking sets it, clicking
              the same one again clears it. Total clears it outright. Total
              Value is a sum, not a subset of rows, so it stays a plain tile —
              there is nothing for it to filter to. */}
          <StatTile
            label="Total (filtered)"
            value={dashboardKpis.total}
            onClick={() => setFStatus('')}
            active={!fStatus}
            ariaPressed={!fStatus}
          />
          {([
            ['active', 'Active', dashboardKpis.active, 'info'],
            ['on_hold', 'On Hold', dashboardKpis.onHold, 'warning'],
            ['won', 'Won', dashboardKpis.won, 'success'],
            ['lost', 'Lost', dashboardKpis.lost, 'danger']
          ] as [ProjectStatus, string, number, 'info' | 'warning' | 'success' | 'danger'][]).map(([status, label, value, tone]) => (
            <StatTile
              key={status}
              label={label}
              value={value}
              tone={tone}
              onClick={() => setFStatus((current) => (current === status ? '' : status))}
              active={fStatus === status}
              ariaPressed={fStatus === status}
            />
          ))}
          {/* Short form in the tile, exact figure on hover: the full value runs
              to eighteen characters and used to render outside the box. */}
          <StatTile
            label="Total Value"
            value={<span title={formatMoney(dashboardKpis.totalValue)}>{formatMoneyCompact(dashboardKpis.totalValue)}</span>}
            tone="brand"
          />
        </div>

        <div className={historyStyles.actionRow}>
          {/* Hidden whenever the table is showing its empty state, because that
              state carries the New button itself. Keyed on the FILTERED rows,
              so a filter matching nothing stands this one down too. Still
              shown while loading (the empty state isn't up yet) and whenever
              the form is open, since this same button is its Cancel. */}
          {(loading || filtered.length > 0 || showForm) && (
            <button type="button" className={calcStyles.btn} onClick={() => setShowForm((v) => !v)}>
              {showForm ? 'Cancel' : '+ New Project'}
            </button>
          )}
          <ToolbarButton onClick={handleExportPdf}>
            Export PDF
          </ToolbarButton>
          <ToolbarButton onClick={() => window.print()}>
            Print
          </ToolbarButton>
          <ToolbarButton onClick={load}>
            Refresh
          </ToolbarButton>
          {/* Chasing the whole roster is an admin job, so this is the only
              button here that is privilege-gated. The dialog previews exactly
              what each person would be told before anything is sent. */}
          {isPrivileged && (
            <ToolbarButton onClick={() => setShowReminders(true)}>
              Detail Reminders
            </ToolbarButton>
          )}
        </div>

        {showReminders && <ProjectDetailRemindersDialog onClose={() => setShowReminders(false)} />}

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
            {possibleDuplicate && (
              <div className={calcStyles.duplicateSuggestion}>
                <span>
                  Are you talking about <strong>{possibleDuplicate.project.clientName || possibleDuplicate.project.company}</strong>
                  {possibleDuplicate.project.company && possibleDuplicate.project.clientName ? ` — ${possibleDuplicate.project.company}` : ''}? A project for them already exists.
                </span>
                <Link className={calcStyles.duplicateSuggestionLink} href={`/projects/${possibleDuplicate.project.id}`} target="_blank" rel="noopener noreferrer">
                  Open it instead →
                </Link>
              </div>
            )}
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
            {/* Project name and where the client is — right after Address,
                where it reads naturally. */}
            <ProjectLocationFields values={form} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} />
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
              <Field label="Opportunity Type *">
                <OpportunityTypeField required disabled={!leadsLoaded} value={form.opportunityType} onChange={handleOpportunityTypeChange} />
              </Field>
              <Field label="Department *">
                <ProjectDepartmentField
                  departments={form.departments}
                  amounts={form.departmentAmounts}
                  onChange={(departments, departmentAmounts) =>
                    setForm((f) => ({
                      ...f,
                      departments,
                      departmentAmounts,
                      // With a split entered, the project's Approx. Price IS
                      // the sum of the parts — written straight back so the
                      // two can never be saved as different numbers.
                      approxPrice: departments.length > 1 ? String(sumDepartmentAmounts(departmentAmounts) || '') : f.approxPrice
                    }))
                  }
                />
                <span className={calcStyles.lockedHint}>
                  Tick every team working this deal. Pick more than one and you can split the value between them.
                </span>
              </Field>
              <Field label="Project Lead / Mentor *">
                <ProjectLeadField required value={form.projectLeadId} onChange={(v) => { setLeadTouched(true); setForm((f) => ({ ...f, projectLeadId: v })); }} />
                <span className={calcStyles.lockedHint}>Pre-filled from the opportunity type (Distribution: Manoj Menon, Project: Pankaj Sharma) — change it if needed.</span>
              </Field>
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
            {!isTechnicalCreator && (
              <Field label="Technical Person(s) *">
                <PersonPicker
                  multiple
                  options={technicalRoster}
                  selectedIds={form.technicalPersonIds}
                  onChange={(ids) => setForm((f) => ({ ...f, technicalPersonIds: ids }))}
                  placeholder="Search technical staff…"
                />
                <span className={calcStyles.lockedHint}>
                  Each person picked gets their own approval request — the project is created now either way.
                </span>
              </Field>
            )}
            {/* Referral / Tender blocks — only for those sources, so they stay
                next to Source rather than up by Address. */}
            <ProjectIntakeFields
              source={form.source}
              values={form}
              onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
            />
            <Field label="Remarks">
              <Textarea rows={2} value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} />
            </Field>
            <SubmitButton disabled={creating}>{creating ? 'Creating…' : 'Create project'}</SubmitButton>
          </form>
        )}

        <FilterPanel>
          <FilterPrimaryRow>
            <FilterSearch
              id="projectFilterSearch"
              label="Search projects"
              placeholder="Search client, company, project ID…"
              value={fSearch}
              onChange={setFSearch}
            />
            {/* Stage and Status stay out in the open: they are the two this
                dashboard is driven by day to day. */}
            <Select
              aria-label="Filter by stage"
              className={quickClass(!!fStage)}
              value={fStage}
              onChange={(e) => setFStage(e.target.value as ProjectStage | '')}
            >
              <option value="">All stages</option>
              {FORWARD_STAGES.concat('closed_lost').map((s) => (
                <option key={s} value={s}>{STAGE_LABEL[s]}</option>
              ))}
            </Select>
            <Select
              aria-label="Filter by status"
              className={quickClass(!!fStatus)}
              value={fStatus}
              onChange={(e) => setFStatus(e.target.value as ProjectStatus | '')}
            >
              <option value="">All statuses</option>
              {(Object.keys(STATUS_LABEL) as ProjectStatus[]).map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </Select>
            <FilterToggle
              open={showFilters}
              onToggle={() => setShowFilters((open) => !open)}
              activeCount={advancedActiveCount}
              controls="projectFilterGrid"
            />
          </FilterPrimaryRow>

          {showFilters && (
            <FilterGrid id="projectFilterGrid">
              {isPrivileged && (
                <FilterField label="Sales person" active={!!fSalesPerson} htmlFor="pfSalesPerson">
                  <Select id="pfSalesPerson" value={fSalesPerson} onChange={(e) => setFSalesPerson(e.target.value)}>
                    <option value="">All sales people</option>
                    {salesPeople.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </Select>
                </FilterField>
              )}
              <FilterField label="Project lead" active={!!fLead} htmlFor="pfLead">
                <Select id="pfLead" value={fLead} onChange={(e) => setFLead(e.target.value)}>
                  <option value="">All project leads</option>
                  {leadOptions.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </Select>
              </FilterField>
              <FilterField label="Opportunity type" active={!!fType} htmlFor="pfType">
                <Select id="pfType" value={fType} onChange={(e) => setFType(e.target.value as OpportunityType | '')}>
                  <option value="">All opportunity types</option>
                  {OPPORTUNITY_TYPES.map((t) => (
                    <option key={t} value={t}>{OPPORTUNITY_TYPE_LABEL[t]}</option>
                  ))}
                </Select>
              </FilterField>
              <FilterField label="Department" active={!!fDepartment} htmlFor="pfDepartment">
                <Select id="pfDepartment" value={fDepartment} onChange={(e) => setFDepartment(e.target.value as ProjectDepartmentFilter)}>
                  <option value="">All departments</option>
                  {PROJECT_DEPARTMENTS.map((d) => (
                    <option key={d} value={d}>{PROJECT_DEPARTMENT_LABEL[d]}</option>
                  ))}
                </Select>
              </FilterField>
              <FilterField label="Source" active={!!fSource} htmlFor="pfSource">
                <Select id="pfSource" value={fSource} onChange={(e) => setFSource(e.target.value)}>
                  <option value="">All sources</option>
                  {sources.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </Select>
              </FilterField>
              <FilterField label="Priority" active={!!fPriority} htmlFor="pfPriority">
                <Select id="pfPriority" value={fPriority} onChange={(e) => setFPriority(e.target.value as ProjectPriority | '')}>
                  <option value="">All priorities</option>
                  {(Object.keys(PRIORITY_LABEL) as ProjectPriority[]).map((p) => (
                    <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
                  ))}
                </Select>
              </FilterField>
              <FilterField label="Confirmation" active={!!fConfirmation} htmlFor="pfConfirmation">
                <Select id="pfConfirmation" value={fConfirmation} onChange={(e) => setFConfirmation(e.target.value)}>
                  <option value="">All confirmations</option>
                  <option value="pending_confirmation">Pending Confirmation</option>
                  <option value="confirmed">Confirmed</option>
                </Select>
              </FilterField>
              {/* Created and Closing each pair their two pickers inside one
                  captioned field, so a range reads as a range — these were
                  four loose date inputs with tiny inline captions. */}
              <FilterField label="Created" active={!!(fFrom || fTo)} htmlFor="pfCreatedFrom">
                <FilterDatePair
                  from={<Input id="pfCreatedFrom" type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} aria-label="Created from" />}
                  to={<Input type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} aria-label="Created to" />}
                />
              </FilterField>
              <FilterField label="Closing date" active={fClosingPreset !== 'all'} htmlFor="pfClosing">
                <Select id="pfClosing" value={fClosingPreset} onChange={(e) => setFClosingPreset(e.target.value as ClosingDatePreset)}>
                  {(Object.keys(CLOSING_PRESET_LABEL) as ClosingDatePreset[]).map((p) => (
                    <option key={p} value={p}>{CLOSING_PRESET_LABEL[p]}</option>
                  ))}
                </Select>
                {fClosingPreset === 'custom' && (
                  <FilterSubRange>
                    <FilterDatePair
                      from={<Input type="date" value={fClosingFrom} onChange={(e) => setFClosingFrom(e.target.value)} aria-label="Closing date from" />}
                      to={<Input type="date" value={fClosingTo} onChange={(e) => setFClosingTo(e.target.value)} aria-label="Closing date to" />}
                    />
                  </FilterSubRange>
                )}
              </FilterField>
            </FilterGrid>
          )}

          <FilterMeta
            count={projectCountLabel(loading, filtered.length, projects.length)}
            activeFilters={activeFilters}
            onClearAll={clearAllFilters}
          />
        </FilterPanel>
        {!loading && !loadFailed && selectedLead && (
          <div className={historyStyles.status}>Showing projects led by {selectedLead.name} and projects {selectedLead.name} owns.</div>
        )}
        {!loading && !loadFailed && hiddenAgedClosedCount > 0 && (
          <div className={historyStyles.status}>
            {hiddenAgedClosedCount} closed project{hiddenAgedClosedCount === 1 ? '' : 's'} older than {CLOSED_PROJECT_HIDE_AFTER_DAYS} days {hiddenAgedClosedCount === 1 ? 'is' : 'are'} hidden — filter Status to Won or Lost to see {hiddenAgedClosedCount === 1 ? 'it' : 'them'}.
          </div>
        )}

        {loading ? (
          <div className={historyStyles.tableWrap}><SkeletonRows rows={8} columns={15} /></div>
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
                action={<button type="button" className={calcStyles.btn} onClick={() => setShowForm(true)}>+ New Project</button>}
              />
            }
          />
        )
        )}
    </AppShell>
  );
}
