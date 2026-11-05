'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { FolderKanban } from 'lucide-react';
import { ProjectPriority, ProjectRecord, ProjectStage, ProjectStatus, UserRole } from '@/lib/types';
import { closingProbabilityStyle, FORWARD_STAGES, STAGE_LABEL, stageProgressPercent } from '@/lib/projectStages';
import { clientDirectoryKey, findClosestClient } from '@/lib/clientSimilarity';
import { closedProjectsVisible, isClosedProject } from '@/lib/projectVisibility';
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
import { usePrompt } from './ui/PromptDialog';
import { useAutoRefresh } from '@/lib/useAutoRefresh';
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
import Pagination from './ui/Pagination';
import Modal, { ModalCancelButton } from './ui/Modal';
import ProjectSourceField from './ui/ProjectSourceField';
import ProjectLeadField from './ui/ProjectLeadField';
import OpportunityTypeField from './ui/OpportunityTypeField';
import ProjectDepartmentField from './ui/ProjectDepartmentField';
import PersonPicker, { PersonPickerOption } from './ui/PersonPicker';
import { useProjectLeads } from './ui/useProjectLeads';
import { OPPORTUNITY_TYPES, OPPORTUNITY_TYPE_LABEL, OpportunityType, nextLeadOnTypeChange } from '@/lib/projectLeadOptions';
import ProjectIntakeFields, { EMPTY_PROJECT_INTAKE, ProjectLocationFields } from './ui/ProjectIntakeFields';
import { fetchCached, invalidateProjectCaches } from '@/lib/fetchCached';
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
  const promptText = usePrompt();
  // The row currently saving a remark, so only that one shows a spinner
  // rather than disabling the whole column.
  const [savingRemarkId, setSavingRemarkId] = useState('');
  const [assignableUsers, setAssignableUsers] = useState<{ id: string; username: string; name: string }[]>([]);
  const [technicalRoster, setTechnicalRoster] = useState<PersonPickerOption[]>([]);
  // Last Remark used to expand on row :hover — a long remark ballooned the
  // row the instant the pointer crossed it anywhere (not just the cell), so
  // just reaching another button in that row made the layout jump. Click is
  // deliberate and stays put, so it's a plain per-row toggle instead.
  const [expandedRemarkIds, setExpandedRemarkIds] = useState<Set<string>>(new Set());
  // The project shown in the quick-view popup, or null. A popup rather than an
  // inline expanding panel: the panel grew the row and pushed the rest of the
  // list down, so reading one project meant scrolling to find your place again.
  const [quickView, setQuickView] = useState<ProjectRecord | null>(null);
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
    fetchCached('/api/users/list?scope=sales')
      .then((users: { id: string; username: string; name: string }[]) => setAssignableUsers(users))
      .catch(() => setAssignableUsers([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // A technical creator IS the project's technical person (see
    // app/api/projects/route.ts) — nobody else needs picking.
    if (isTechnicalCreator) return;
    fetchCached('/api/technical-roster')
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
  // An explicit "show me the finished ones too", independent of the other
  // filters, so the hidden-count notice has something to offer.
  const [includeClosed, setIncludeClosed] = useState(false);
  const [fSearch, setFSearch] = useState('');
  const [fClosingPreset, setFClosingPreset] = useState<ClosingDatePreset>('all');
  const [fClosingFrom, setFClosingFrom] = useState('');
  const [fClosingTo, setFClosingTo] = useState('');
  // ?newForClient=<name> — Client Master's "New Project" action, so adding a
  // second project for an existing client starts from that client instead of
  // an empty form. Read once on mount, same shape as the filter deep-links
  // below (and for the same reason: useSearchParams would force this whole
  // view behind a Suspense boundary).
  //
  // Held until `projects` has loaded, because the contact details are copied
  // from that client's most recent project — the name in the URL alone would
  // leave the phone, email and address to be retyped.
  const [pendingClientName, setPendingClientName] = useState(() => {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('newForClient') || '';
  });

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
  // ?filter=pending_confirmation is only ever produced by the Dashboard's
  // "Projects awaiting YOUR confirmation" item, so it means MINE — not every
  // pending project in view. Without this a manager landed on 19 projects
  // and could act on none of them, because only the creator is shown the
  // confirm banner (components/ProjectDetailView.tsx).
  const [fAwaitingMine, setFAwaitingMine] = useState(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('filter') === 'pending_confirmation';
  });
  // The counterpart link: everything pending that is somebody ELSE's to
  // confirm. Shown to whoever sees more than their own projects, so a
  // manager keeps sight of the backlog without being told it is theirs.
  const [fAwaitingTeam, setFAwaitingTeam] = useState(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('filter') === 'team_pending_confirmation';
  });
  // Nine of the fourteen filters sit behind the Filters toggle. It starts open
  // when a deep link arrived with one of those already applied (Dashboard's
  // department cards and its "awaiting your confirmation" item both do), so
  // the panel never starts collapsed over a filter the user did not set.
  const [showFilters, setShowFilters] = useState(() => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    const filter = params.get('filter');
    return isProjectDepartment(params.get('department') ?? '') || filter === 'pending_confirmation' || filter === 'team_pending_confirmation';
  });

  // Custom Range reveals its own two date inputs; every other preset
  // resolves to a fixed [from, to] window computed once per render (cheap —
  // plain Date arithmetic, no fetch). Moved up here (was declared further
  // down, after `filtered`) because buildProjectParams/the fetch-triggering
  // effects below now need it too.
  const closingRange = useMemo(
    () => (fClosingPreset === 'custom' ? { from: fClosingFrom, to: fClosingTo } : closingDatePresetRange(fClosingPreset)),
    [fClosingPreset, fClosingFrom, fClosingTo]
  );

  // Any date range in play means closed deals belong in the answer: someone
  // searching a range is asking what happened then, and omitting everything
  // that closed would make the search quietly wrong. Covers both the created
  // range and the expected-closing range.
  const dateFilterActive = Boolean(fFrom || fTo || closingRange.from || closingRange.to);
  const showClosed = closedProjectsVisible({
    statusFilter: fStatus,
    dateFilterActive,
    userOverride: includeClosed
  });

  // Filtering, sorting and pagination now happen on the server
  // (lib/projectStore.ts's listFiltered) — the full visible set (plus, on
  // every load, a DISTINCT ON across the whole project_timeline_events table
  // for the Last Remark column) no longer round-trips through the browser
  // just to decide what ~20 rows to show.
  const PROJECTS_PAGE_SIZE = 20;
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [facets, setFacets] = useState<{
    statusCounts: Record<ProjectStatus, number>;
    hiddenClosedCount: number;
    totalValue: number;
    total: number;
    grandTotal: number;
  } | null>(null);
  // The Sales Person / Source dropdown option lists and the client
  // directory (id/client_name/company for every visible project, used by
  // the New Project form's duplicate-client nudge) — both need the viewer's
  // FULL set regardless of the main table's current filters/page, so they
  // come from their own lightweight endpoints now rather than being derived
  // from `projects` (which is just the current page).
  const [filterOptions, setFilterOptions] = useState<{ salesPeople: { username: string; name: string }[]; sources: string[] }>({ salesPeople: [], sources: [] });
  const [clientDirectory, setClientDirectory] = useState<{ id: string; client_name: string; company: string; contact_person: string; phone: string; alt_contact_phone: string; email: string; address: string }[]>([]);
  // Debounced the same way components/LeadsView.tsx's search is — filtering
  // moved server-side, so a request per keystroke would be a network round
  // trip where the old in-browser .filter() cost nothing.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(fSearch), 300);
    return () => clearTimeout(t);
  }, [fSearch]);

  // Every filter the backend understands, as query params — shared by load()
  // (the page's rows), loadFacets() (the status tiles / total value) and
  // handleExportPdf() (everything matching, unpaginated). Resolves the
  // closed-visibility rule client-side (closedProjectsVisible is pure, no
  // reason to duplicate it server-side) and sends the result as one flag.
  function buildProjectParams(): URLSearchParams {
    const params = new URLSearchParams();
    if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim());
    if (fStage) params.set('stage', fStage);
    if (fStatus) params.set('status', fStatus);
    if (fPriority) params.set('priority', fPriority);
    if (fSalesPerson) params.set('salesPerson', fSalesPerson);
    if (fSource) params.set('source', fSource);
    if (fDepartment) params.set('department', fDepartment);
    if (fType) params.set('type', fType);
    if (fLead) params.set('lead', fLead);
    if (fFrom) params.set('from', fFrom);
    if (fTo) params.set('to', fTo);
    if (closingRange.from) params.set('closingFrom', closingRange.from);
    if (closingRange.to) params.set('closingTo', closingRange.to);
    if (fAwaitingMine) params.set('awaitingMine', '1');
    else if (fAwaitingTeam) params.set('awaitingTeam', '1');
    else if (fConfirmation) params.set('confirmation', fConfirmation);
    if (showClosed) params.set('includeClosed', '1');
    return params;
  }

  async function loadFacets() {
    try {
      const response = await fetch(`/api/projects/facets?${buildProjectParams().toString()}`);
      if (response.ok) setFacets(await response.json());
    } catch {
      setFacets(null);
    }
  }

  async function load(options: { silent?: boolean } = {}) {
    if (!options.silent) setLoading(true);
    setLoadFailed(false);
    try {
      const params = buildProjectParams();
      params.set('page', String(page));
      params.set('pageSize', String(PROJECTS_PAGE_SIZE));
      params.set('remarks', '1');
      // Not cached: this is the live list people work from, auto-refreshed
      // on focus.
      const response = await fetch(`/api/projects?${params.toString()}`);
      if (!response.ok) throw new Error(String(response.status));
      const data: { projects: ProjectRecord[]; total: number } = await response.json();
      setProjects(data.projects);
      setTotal(data.total);
      setLoaded(true);
    } catch {
      setLoadFailed(true);
    } finally {
      if (!options.silent) setLoading(false);
    }
  }

  async function loadFilterOptionsAndDirectory() {
    try {
      const [optionsRes, directoryRes] = await Promise.all([fetch('/api/projects/filter-options'), fetch('/api/projects/client-directory')]);
      if (optionsRes.ok) setFilterOptions(await optionsRes.json());
      if (directoryRes.ok) setClientDirectory(await directoryRes.json());
    } catch {
      // Both are secondary (dropdown options, a nudge) — a failed fetch
      // leaves them empty rather than breaking the main list.
    }
  }

  useEffect(() => {
    loadFilterOptionsAndDirectory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A filter changing invalidates the page (results may no longer span as
  // many pages) — same reasoning as components/LeadsView.tsx's identical
  // reset effect.
  useEffect(() => {
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, fStage, fStatus, fPriority, fSalesPerson, fSource, fDepartment, fType, fLead, fFrom, fTo, closingRange.from, closingRange.to, fAwaitingMine, fAwaitingTeam, fConfirmation, showClosed]);

  // The actual fetches — fire on mount, on every filter settling (via the
  // page reset above), and on page navigation.
  useEffect(() => {
    load();
    loadFacets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, debouncedSearch, fStage, fStatus, fPriority, fSalesPerson, fSource, fDepartment, fType, fLead, fFrom, fTo, closingRange.from, closingRange.to, fAwaitingMine, fAwaitingTeam, fConfirmation, showClosed]);

  // Keeps the list current without reloading the page — refetches when the
  // tab regains focus, and slowly while it is visible. See
  // lib/useAutoRefresh.ts for why the cadence is deliberately slow. Silent:
  // this fires every 60s or on every tab-focus, and must not flash a
  // loading state over whatever is on screen.
  useAutoRefresh(() => {
    load({ silent: true });
    loadFacets();
  });

  // Unfiltered — the viewer's whole visible set, from their own lightweight
  // endpoint (lib/projectStore.ts's listFilterOptions) rather than derived
  // from `projects`, which is now just the current page.
  const salesPeople = filterOptions.salesPeople.map((p) => p.username);
  const salesPersonNameByUsername = useMemo(() => new Map(filterOptions.salesPeople.map((p) => [p.username, p.name])), [filterOptions]);
  const sources = filterOptions.sources;

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
    if (fSalesPerson) out.push({ key: 'salesPerson', label: 'Sales person', value: salesPersonNameByUsername.get(fSalesPerson) || fSalesPerson, clear: () => setFSalesPerson('') });
    if (fLead) out.push({ key: 'lead', label: 'Project lead', value: selectedLead?.name ?? fLead, clear: () => setFLead('') });
    if (fType) out.push({ key: 'type', label: 'Opportunity', value: OPPORTUNITY_TYPE_LABEL[fType], clear: () => setFType('') });
    if (fDepartment) out.push({ key: 'department', label: 'Department', value: PROJECT_DEPARTMENT_LABEL[fDepartment], clear: () => setFDepartment('') });
    if (fSource) out.push({ key: 'source', label: 'Source', value: fSource, clear: () => setFSource('') });
    if (fPriority) out.push({ key: 'priority', label: 'Priority', value: PRIORITY_LABEL[fPriority], clear: () => setFPriority('') });
    if (fAwaitingTeam) {
      out.push({
        key: 'awaiting-team',
        label: 'Confirmation',
        value: 'Awaiting the team’s confirmation',
        clear: () => { setFAwaitingTeam(false); setFConfirmation(''); }
      });
    } else if (fAwaitingMine) {
      out.push({
        key: 'awaiting-mine',
        label: 'Confirmation',
        value: 'Awaiting my confirmation',
        clear: () => { setFAwaitingMine(false); setFConfirmation(''); }
      });
    } else if (fConfirmation) {
      out.push({ key: 'confirmation', label: 'Confirmation', value: CONFIRMATION_LABEL[fConfirmation] ?? fConfirmation, clear: () => setFConfirmation('') });
    }
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
  }, [fSearch, fStage, fStatus, fSalesPerson, salesPersonNameByUsername, fLead, selectedLead, fType, fDepartment, fSource, fPriority, fConfirmation, fAwaitingMine, fAwaitingTeam, fFrom, fTo, fClosingPreset, fClosingFrom, fClosingTo]);

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
  // `projects` is now just the current page — filtering/pagination happen on
  // the server (lib/projectStore.ts's listFiltered), so `filtered` IS
  // `projects` (the backend already applied every filter, including status
  // and closed-visibility, before returning this page). `pageRows` is kept
  // as its own name only so the Table/count-label code below reads the same
  // as components/LeadsView.tsx's equivalent.
  const filtered = projects;
  const pageRows = projects;

  // The status-tile counts, the hidden-closed notice and the Total Value KPI
  // — all three now come from GET /api/projects/facets (lib/projectStore.ts's
  // getFacets), computed server-side over the viewer's full filtered set,
  // not just this page. See that function for the one copy of this
  // arithmetic (departmentValueOf, closed-visibility).
  const hiddenClosedCount = facets?.hiddenClosedCount ?? 0;
  const dashboardKpis = {
    total: facets?.total ?? 0,
    won: facets?.statusCounts.won ?? 0,
    lost: facets?.statusCounts.lost ?? 0,
    active: facets?.statusCounts.active ?? 0,
    onHold: facets?.statusCounts.on_hold ?? 0,
    totalValue: facets?.totalValue ?? 0
  };

  // A live, non-blocking nudge while the New Project form is open — the
  // typed client name/company against every project the viewer can see
  // (lib/projectStore.ts's listClientDirectory, loaded once on mount — see
  // loadFilterOptionsAndDirectory), not just whatever page the main table
  // happens to be showing. Suggestion only: it never blocks or auto-cancels
  // the submit.
  const possibleDuplicate = useMemo(
    () => (showForm
      ? findClosestClient(form.clientName, form.company, clientDirectory.map((p) => ({ id: p.id, clientName: p.client_name, company: p.company })))
      : null),
    [showForm, form.clientName, form.company, clientDirectory]
  );

  // Arriving from Client Master's "New Project": open the form and fill in
  // that client, once the client directory has actually loaded. Runs once —
  // the pending name is cleared whether or not a match was found, so a
  // client who somehow has no project still gets an open form rather than a
  // loop.
  useEffect(() => {
    if (!pendingClientName || !clientDirectory.length) return;
    const wanted = clientDirectoryKey(pendingClientName);
    const match = clientDirectory.find((p) => clientDirectoryKey(p.company || p.client_name) === wanted);
    setShowForm(true);
    if (match) useExistingClient(match.id, { quiet: true });
    else setForm((f) => ({ ...f, company: pendingClientName }));
    setPendingClientName('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingClientName, clientDirectory]);

  /**
   * Copies an existing client's details into the open New Project form.
   *
   * This is what the duplicate suggestion should always have offered. A
   * second project for an existing client is the ordinary case — a fit-out
   * after a supply, a new site, next year's order — and the suggestion's
   * only action was a link that navigated away, so choosing the client you
   * meant threw away the project you were creating.
   *
   * Copies the client identity and contact fields ONLY. Nothing about the
   * previous deal — no value, no stage, no departments, no assignees —
   * because this is a new project for the same client, not a copy of their
   * last one.
   */
  function useExistingClient(projectId: string, options: { quiet?: boolean } = {}) {
    const source = clientDirectory.find((p) => p.id === projectId);
    if (!source) return;
    setForm((f) => ({
      ...f,
      clientName: source.client_name || f.clientName,
      company: source.company || f.company,
      contactPerson: source.contact_person || f.contactPerson,
      phone: source.phone || f.phone,
      altContactPhone: source.alt_contact_phone || f.altContactPhone,
      email: source.email || f.email,
      address: source.address || f.address
    }));
    // Quiet when the form was opened FROM Client Master: the person asked for
    // this client, so confirming it back at them is noise. The toast matters
    // only when they clicked the duplicate suggestion, where the point is
    // that a new project is still being created.
    if (!options.quiet) {
      toast.success('Client details filled in. This still creates a new project for them.');
    }
  }

  // Adding a remark without leaving the dashboard. Deliberately the same
  // PATCH the detail view's timeline box uses, so a remark added here is the
  // same kind of record and shows up in the same places — including this
  // column, which is what the person adding it wanted in the first place.
  async function handleAddRemark(project: ProjectRecord) {
    const label = project.client_name || project.company || "this project";
    const text = await promptText({
      title: `Add remark — ${label}`,
      message: 'Visible on the Project Dashboard and on the project timeline.',
      placeholder: 'e.g. Client asked us to revise the lighting spec',
      confirmLabel: 'Add remark',
      validate: (v) => (v.trim() ? null : 'Type the remark first.')
    });
    if (text === null) return;
    const remarks = text.trim();
    if (!remarks) return;

    setSavingRemarkId(project.id);
    try {
      const response = await fetch(`/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'addRemark', remarks })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({} as { error?: string }));
        toast.error(body.error || `Could not add the remark (HTTP ${response.status}).`);
        return;
      }
      toast.success('Remark added.');
      invalidateProjectCaches();
      // Reloaded rather than patched into local state: last_remark is
      // resolved server-side by GET /api/projects (listLastRemarks), so the
      // row has no way to compute its own new value.
      await load();
    } catch {
      toast.error('Could not reach the server.');
    } finally {
      setSavingRemarkId('');
    }
  }

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
      // A new project has to appear in every picker at once, so the cached
      // copy they share goes rather than ageing out over the next minute.
      invalidateProjectCaches();
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
      // A deleted project must leave every picker, not linger for the minute
      // the cached options would otherwise live.
      invalidateProjectCaches();
      setProjects((prev) => prev.filter((p) => p.id !== id));
      // Silent refetch — `total`/the facet counts need to drop by one, and a
      // deleted last-row-on-the-page should pull one in from the next page.
      load({ silent: true });
      loadFacets();
    } catch {
      toast.error('Could not delete this project.');
    }
  }

  const [exportingPdf, setExportingPdf] = useState(false);

  // `filtered`/`projects` is just the current page now — the export has
  // always meant "everything matching the filters", so it fetches that set
  // fresh rather than exporting only what happens to be on screen. A plain
  // large pageSize rather than a dedicated "no pagination" mode: the backend
  // already caps it (MAX_PROJECT_PAGE_SIZE in lib/projectStore.ts), and this
  // view's own filtered sets have never run anywhere near that.
  async function handleExportPdf() {
    setExportingPdf(true);
    try {
      const params = buildProjectParams();
      params.set('page', '1');
      params.set('pageSize', '5000');
      const response = await fetch(`/api/projects?${params.toString()}`);
      if (!response.ok) throw new Error(String(response.status));
      const data: { projects: ProjectRecord[]; total: number } = await response.json();
      exportListToPdf(
        'Project Dashboard',
        ['Client', 'Company', 'Sales Person', 'Department', 'Project Lead', 'Source', 'Approx. Price', 'Stage', 'Status', 'Priority', 'Last Updated', 'Next Follow-up', 'Closing %'],
        data.projects.map((p) => [p.client_name, p.company, p.sales_person_name || p.sales_person, formatProjectDepartments(p.departments), p.project_lead_name ? `${p.project_lead_name}${p.opportunity_type ? ` (${OPPORTUNITY_TYPE_LABEL[p.opportunity_type]})` : ''}` : '-', p.source || '-', formatMoney(p.approx_price), STAGE_LABEL[p.stage], STATUS_LABEL[p.status], PRIORITY_LABEL[p.priority], formatDateTime(p.updated_at), formatDate(p.next_follow_up_date), p.closing_probability_percent === '' ? '-' : `${p.closing_probability_percent}%`]),
        `projects-${new Date().toISOString().slice(0, 10)}.pdf`
      );
    } catch {
      toast.error('Could not export the PDF. Please try again.');
    } finally {
      setExportingPdf(false);
    }
  }

  // The three fields the table no longer has room for. Defined once and used
  // by the quick-view popup so there is a single rendering of each — the old
  // columns and a second copy in the popup would have drifted.
  function renderStatus(p: ProjectRecord) {
    return p.status === 'won' || p.status === 'lost' ? (
      <StatusBadge tone={p.status} label={p.status === 'lost' ? 'Closed Lost' : STATUS_LABEL[p.status]} />
    ) : (
      <>{STATUS_LABEL[p.status]}</>
    );
  }

  function renderConfirmation(p: ProjectRecord) {
    return p.lead_confirmation_status === 'pending_confirmation' ? (
      <StatusBadge tone="pending" label="Pending Confirmation" />
    ) : p.lead_confirmation_status === 'confirmed' ? (
      <StatusBadge tone="confirmed" label="Confirmed" />
    ) : (
      <>-</>
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
    { key: 'salesPerson', header: 'Sales Person', headerClassName: historyStyles.colSalesPerson, render: (p) => p.sales_person_name || p.sales_person },
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
    {
      key: 'source',
      header: 'Source',
      headerClassName: historyStyles.colSource,
      // Partner-sourced projects carry the partner's name and code under the
      // source, and an "Awaiting review" marker while Sales has not yet
      // accepted them — the requirement that these be visibly identified as
      // partner-sourced wherever they appear.
      render: (p) =>
        p.partner_name ? (
          <>
            {p.source || 'Partner'}
            <div className={calcStyles.small}>
              {p.partner_name} ({p.partner_code})
            </div>
            {(p.partner_submission_status === 'submitted' || p.partner_submission_status === 'info_requested') && (
              <div className={calcStyles.small}>
                <strong>
                  {p.partner_submission_status === 'submitted' ? 'Awaiting review' : 'Info requested'}
                </strong>
              </div>
            )}
          </>
        ) : (
          p.source || '-'
        )
    },
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
    // Status, Confirmation, Next Follow-up and Last Updated used to sit here.
    // Fifteen columns could not fit any screen — measured in the browser, the
    // table needed 1420px against 968px available at 1280px wide and 1384px
    // at 1920px, so it scrolled sideways at EVERY size. All four are in the
    // quick-view popup instead, and Status additionally survives in the
    // Progress column, which already prints "Won" and "Closed Lost" in place
    // of a percentage. Last Updated went last, to free the width two row
    // buttons need.
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
      render: (p) => (
        <>
          {p.last_remark ? (
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
          )}
          {/* The whole point of the change: a rep can leave a remark from
              here instead of opening the project and scrolling to the
              timeline box — which is why they were using Notes, where
              nothing outside the project detail ever shows it. */}
          <button
            type="button"
            className={historyStyles.addRemarkBtn}
            disabled={savingRemarkId === p.id}
            onClick={() => handleAddRemark(p)}
            title="Add a remark visible on this dashboard"
          >
            {savingRemarkId === p.id ? 'Saving…' : p.last_remark ? '+ Add' : '+ Add remark'}
          </button>
        </>
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
      headerClassName: historyStyles.colActionsWide,
      cellClassName: historyStyles.rowActionsInline,
      render: (p) => (
        <>
          {/* Two ways in: a popup for a quick look without losing your place
              in the list, and the full page for the real work. A menu rather
              than two side-by-side buttons because this column is 8% of a
              table that must not scroll sideways — two buttons plus Delete
              did not fit. */}
          {/* Two plain buttons rather than a dropdown: both choices are one
              click, and nothing has to be opened to discover what the options
              are. Last Updated gave up its column to make room. */}
          <button
            type="button"
            className={`${historyStyles.rowAction} ${historyStyles.rowActionPrimary}`}
            onClick={() => setQuickView(p)}
            title={`Quick view — ${p.client_name || 'project'}`}
          >
            View
          </button>
          <Link
            className={historyStyles.rowAction}
            href={`/projects/${p.id}`}
            title={`Open the full project page for ${p.client_name || 'this project'}`}
          >
            Details
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
          <ToolbarButton onClick={handleExportPdf} disabled={exportingPdf}>
            {exportingPdf ? 'Exporting…' : 'Export PDF'}
          </ToolbarButton>
          <ToolbarButton onClick={() => window.print()}>
            Print
          </ToolbarButton>
          <ToolbarButton onClick={() => { load(); loadFacets(); }}>
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

        {/* Quick view. A fixed-size popup, deliberately: it shows everything
            the table dropped (Status, Confirmation, Next Follow-up) at a
            glance, with no scrolling of its own and without moving the list
            underneath. "Full details" is one click away for anything more. */}
        {quickView && (
          <Modal
            title={quickView.client_name || quickView.company || 'Project'}
            ariaLabel={`Quick view — ${quickView.client_name || quickView.company || 'project'}`}
            onClose={() => setQuickView(null)}
            // Wide so .quickFacts' auto-fit grid gets two columns: in the
            // default card it measured 372px, which fits only one, turning
            // twelve facts into a tall single file.
            size="wide"
            footer={
              <>
                <ModalCancelButton onClick={() => setQuickView(null)}>Close</ModalCancelButton>
                <Link className={calcStyles.btn} href={`/projects/${quickView.id}`}>
                  Open full details
                </Link>
              </>
            }
          >
            <dl className={historyStyles.quickFacts}>
              <div><dt>Company</dt><dd>{quickView.company || '-'}</dd></div>
              <div><dt>Sales Person</dt><dd>{quickView.sales_person_name || quickView.sales_person || '-'}</dd></div>
              <div><dt>Department</dt><dd>{formatProjectDepartments(quickView.departments) || '-'}</dd></div>
              <div><dt>Project Lead</dt><dd>{quickView.project_lead_name || '-'}</dd></div>
              <div><dt>Opportunity</dt><dd>{quickView.opportunity_type ? OPPORTUNITY_TYPE_LABEL[quickView.opportunity_type] : '-'}</dd></div>
              <div><dt>Source</dt><dd>{quickView.source || '-'}</dd></div>
              <div><dt>Stage</dt><dd>{STAGE_LABEL[quickView.stage]}</dd></div>
              <div><dt>Status</dt><dd>{renderStatus(quickView)}</dd></div>
              <div><dt>Confirmation</dt><dd>{renderConfirmation(quickView)}</dd></div>
              <div><dt>Next Follow-up</dt><dd>{formatDate(quickView.next_follow_up_date) || '-'}</dd></div>
              <div><dt>Closing %</dt><dd>{quickView.closing_probability_percent != null ? `${quickView.closing_probability_percent}%` : '-'}</dd></div>
              <div><dt>Last Updated</dt><dd>{formatDateTime(quickView.updated_at)}</dd></div>
            </dl>
            {quickView.last_remark && (
              <div className={historyStyles.quickRemark}>
                <div className={historyStyles.quickRemarkHead}>
                  Last remark — {quickView.last_remark_by}, {formatDateTime(quickView.last_remark_at)}
                </div>
                <p>{quickView.last_remark}</p>
              </div>
            )}
          </Modal>
        )}

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
                  {possibleDuplicate.project.company && possibleDuplicate.project.clientName ? ` — ${possibleDuplicate.project.company}` : ''}? They already have a project.
                </span>
                {/* "Use their details" is the primary action and it KEEPS you
                    on this form. The only option here used to be a link that
                    navigated away to the existing project, so picking the
                    suggested client abandoned the new project you were
                    creating — the common case is a second project for a
                    client we already have, not a mistake. */}
                <button
                  type="button"
                  className={calcStyles.duplicateSuggestionAction}
                  onClick={() => useExistingClient(possibleDuplicate.project.id)}
                >
                  Use their details for this new project
                </button>
                <Link className={calcStyles.duplicateSuggestionLink} href={`/projects/${possibleDuplicate.project.id}`} target="_blank" rel="noopener noreferrer">
                  Open the existing one
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
                      <option key={s} value={s}>{salesPersonNameByUsername.get(s) || s}</option>
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
                <Select id="pfConfirmation" value={fConfirmation} onChange={(e) => { setFAwaitingMine(false); setFAwaitingTeam(false); setFConfirmation(e.target.value); }}>
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
            count={projectCountLabel(loading, dashboardKpis.total, facets?.grandTotal ?? 0)}
            activeFilters={activeFilters}
            onClearAll={clearAllFilters}
          />
        </FilterPanel>
        {/* Says what this view is, and — when empty — why. Arriving from the
            Dashboard with nothing to confirm previously showed a blank table
            with no explanation. */}
        {!loading && !loadFailed && fAwaitingTeam && (
          <div className={historyStyles.status}>
            {dashboardKpis.total > 0 ? (
              <>
                Showing {dashboardKpis.total} project{dashboardKpis.total === 1 ? '' : 's'} waiting on someone else to confirm.
                Only the person who owns each one can confirm it.
              </>
            ) : (
              <>
                Nothing is waiting on the team.{' '}
                <button type="button" className={historyStyles.linkBtn} onClick={() => { setFAwaitingTeam(false); setFConfirmation(''); }}>
                  Show all projects
                </button>
              </>
            )}
          </div>
        )}
        {!loading && !loadFailed && fAwaitingMine && (
          <div className={historyStyles.status}>
            {dashboardKpis.total > 0 ? (
              <>
                Showing the {dashboardKpis.total} project{dashboardKpis.total === 1 ? '' : 's'} waiting for <strong>your</strong>{' '}
                confirmation. Open one to confirm it.
              </>
            ) : (
              <>
                Nothing is waiting for your confirmation.{' '}
                <button type="button" className={historyStyles.linkBtn} onClick={() => { setFAwaitingMine(false); setFConfirmation(''); }}>
                  Show all projects
                </button>
              </>
            )}
          </div>
        )}
        {!loading && !loadFailed && selectedLead && (
          <div className={historyStyles.status}>Showing projects led by {selectedLead.name} and projects {selectedLead.name} owns.</div>
        )}
        {!loading && !loadFailed && hiddenClosedCount > 0 && (
          <div className={historyStyles.status}>
            {hiddenClosedCount} closed project{hiddenClosedCount === 1 ? '' : 's'} (Won/Lost) {hiddenClosedCount === 1 ? 'is' : 'are'} hidden.{' '}
            <button type="button" className={historyStyles.linkBtn} onClick={() => setIncludeClosed(true)}>
              Show {hiddenClosedCount === 1 ? 'it' : 'them'}
            </button>
            {' '}— or filter Status to Won/Lost, or set any date range.
          </div>
        )}
        {!loading && !loadFailed && includeClosed && (
          <div className={historyStyles.status}>
            Closed projects are shown.{' '}
            <button type="button" className={historyStyles.linkBtn} onClick={() => setIncludeClosed(false)}>Hide them again</button>
          </div>
        )}

        {loading ? (
          <div className={historyStyles.tableWrap}><SkeletonRows rows={8} columns={11} /></div>
        ) : loadFailed ? (
          <ErrorState message="Could not load projects — check your connection and try again." onRetry={() => load()} />
        ) : (
        loaded && (
          <>
          <Table
            columns={columns}
            rows={pageRows}
            rowKey={(p) => p.id}
            tableClassName={historyStyles.tableFixed}
            wrapClassName={historyStyles.tableViewport}
            empty={
              <EmptyState
                icon={FolderKanban}
                title={(facets?.grandTotal ?? 0) === 0 ? 'No projects yet' : 'No projects match your filters'}
                message={(facets?.grandTotal ?? 0) === 0 ? (isTechnicalCreator ? "Projects you're assigned to as technical lead show up here — or create one for a sales person when needed." : 'Create your first project to start tracking it through the pipeline.') : 'Try clearing a filter or search term.'}
                action={<button type="button" className={calcStyles.btn} onClick={() => setShowForm(true)}>+ New Project</button>}
              />
            }
          />
          <Pagination page={page} totalPages={Math.max(1, Math.ceil((facets?.total ?? 0) / PROJECTS_PAGE_SIZE))} onChange={setPage} />
          </>
        )
        )}
    </AppShell>
  );
}
