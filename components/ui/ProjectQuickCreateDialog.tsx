'use client';

import { FormEvent, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ProjectPriority, ProjectRecord } from '@/lib/types';
import { todayDateInputValue } from '@/lib/dateHelpers';
import { isTechnicalRole } from '@/lib/technicalRoles';
import { findClosestClient } from '@/lib/clientSimilarity';
import PhoneInput from './PhoneInput';
import ProjectSourceField from './ProjectSourceField';
import { useToast } from './ToastProvider';
import notifyStyles from './notify.module.css';
import calcStyles from '../calculator.module.css';

// Same field set and same POST /api/projects call as components/ProjectsView.tsx's
// own "+ New Project" form (its EMPTY_FORM/handleCreate) — one implementation
// of "create a project," reused here so every project selector across the app
// (Quotation, Site Visit, Demo, Travel, Marketing) can offer "+ Add New
// Project" without duplicating creation/validation logic.
interface ProjectCreateForm {
  clientName: string;
  company: string;
  contactPerson: string;
  altContactPhone: string;
  phone: string;
  email: string;
  address: string;
  salesPersonId: string;
  source: string;
  priority: ProjectPriority;
  expectedClosingDate: string;
  remarks: string;
  approxPrice: string;
}

const EMPTY_FORM: ProjectCreateForm = {
  clientName: '', company: '', contactPerson: '', altContactPhone: '', phone: '', email: '', address: '',
  salesPersonId: '', source: '', priority: 'medium', expectedClosingDate: '', remarks: '', approxPrice: ''
};

interface PendingCreate {
  prefill: Partial<ProjectCreateForm>;
  resolve: (project: ProjectRecord | null) => void;
}

const ProjectQuickCreateContext = createContext<((prefill?: Partial<ProjectCreateForm>) => Promise<ProjectRecord | null>) | null>(null);

export function ProjectQuickCreateProvider({ children }: { children: React.ReactNode }) {
  const toast = useToast();
  const [pending, setPending] = useState<PendingCreate | null>(null);
  const [form, setForm] = useState<ProjectCreateForm>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [assignableUsers, setAssignableUsers] = useState<{ id: string; username: string; name: string }[]>([]);
  const [viewer, setViewer] = useState<{ role: string; isPrivileged: boolean } | null>(null);
  const [existingProjects, setExistingProjects] = useState<ProjectRecord[]>([]);

  // The Sales person picker follows the same rule as POST /api/projects:
  // privileged → anyone, defaults to self; technical staff → a sales person
  // is required (they own the project); everyone else → no picker, the
  // project is always their own. Re-resolved on every open since this
  // provider outlives a logout/login as someone else.
  useEffect(() => {
    if (!pending) return;
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((me: { role?: string; isPrivileged?: boolean } | null) => {
        const next = me ? { role: me.role || '', isPrivileged: !!me.isPrivileged } : null;
        setViewer(next);
        if (!next || (!next.isPrivileged && !isTechnicalRole(next.role))) return [];
        // Sales team only for every creator, privileged included — the person
        // picked here owns the project. Same rule as ProjectsView's form and
        // as the server enforces in app/api/projects/route.ts.
        return fetch('/api/users/list?scope=sales').then((r) => (r.ok ? r.json() : []));
      })
      .then((users: { id: string; username: string; name: string }[]) => setAssignableUsers(users))
      .catch(() => setAssignableUsers([]));
  }, [pending]);

  // For the live "are you talking about this client?" nudge below — same
  // full list components/ui/ProjectSelect.tsx already fetches for its own
  // dropdown, re-fetched here since this dialog is a standalone context
  // provider with no access to that instance's state.
  useEffect(() => {
    if (!pending) return;
    fetch('/api/projects')
      .then((r) => (r.ok ? r.json() : []))
      .then(setExistingProjects)
      .catch(() => setExistingProjects([]));
  }, [pending]);

  const isTechnicalCreator = !!viewer && !viewer.isPrivileged && isTechnicalRole(viewer.role);

  // Suggestion only — never blocks Create. Resolving with the matched
  // existing record via `close()` short-circuits the rest of this form
  // exactly like a normal successful creation would, from the caller's side.
  const possibleDuplicate = useMemo(
    () => findClosestClient(
      form.clientName,
      form.company,
      existingProjects.map((p) => ({ id: p.id, clientName: p.client_name, company: p.company }))
    ),
    [form.clientName, form.company, existingProjects]
  );

  const open = useCallback((prefill?: Partial<ProjectCreateForm>) => {
    return new Promise<ProjectRecord | null>((resolve) => {
      setForm({ ...EMPTY_FORM, ...prefill });
      setPending({ prefill: prefill || {}, resolve });
    });
  }, []);

  function close(project: ProjectRecord | null) {
    pending?.resolve(project);
    setPending(null);
  }

  async function handleSubmit(e: FormEvent) {
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
      const { warning, ...project } = body as ProjectRecord & { warning?: string };
      // `warning`: created, but the technical creator couldn't be added as
      // its technical person — say so rather than claim they were.
      if (warning) {
        toast.error(warning);
      } else if (isTechnicalCreator) {
        const salesPerson = assignableUsers.find((u) => u.id === form.salesPersonId);
        toast.success(`Project created for ${salesPerson ? salesPerson.name || salesPerson.username : 'the sales person'} — you're its technical person.`);
      } else {
        toast.success('Project created.');
      }
      close(project);
    } catch {
      toast.error('Could not create this project. Please try again.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <ProjectQuickCreateContext.Provider value={open}>
      {children}
      {pending && (
        <div className={notifyStyles.overlay} role="presentation" onClick={() => close(null)}>
          <div className={notifyStyles.wideCard} role="dialog" aria-modal="true" aria-label="Add New Project" onClick={(e) => e.stopPropagation()}>
            <div className={notifyStyles.confirmTitle}>Add New Project</div>
            <form onSubmit={handleSubmit}>
              <div className={`${calcStyles.row} ${calcStyles.columns}`}>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Client Representative Name</label>
                  <input className={calcStyles.formControl} value={form.clientName} onChange={(e) => setForm((f) => ({ ...f, clientName: e.target.value }))} />
                </div>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Company</label>
                  <input className={calcStyles.formControl} value={form.company} onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))} />
                </div>
              </div>
              {possibleDuplicate && (
                <div className={calcStyles.duplicateSuggestion}>
                  <span>
                    Are you talking about <strong>{possibleDuplicate.project.clientName || possibleDuplicate.project.company}</strong>
                    {possibleDuplicate.project.company && possibleDuplicate.project.clientName ? ` — ${possibleDuplicate.project.company}` : ''}? A project for them already exists.
                  </span>
                  <button
                    type="button"
                    className={calcStyles.duplicateSuggestionLink}
                    onClick={() => {
                      const existing = existingProjects.find((p) => p.id === possibleDuplicate.project.id);
                      if (existing) close(existing);
                    }}
                  >
                    Use this project instead →
                  </button>
                </div>
              )}
              <div className={`${calcStyles.row} ${calcStyles.columns}`}>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Phone</label>
                  <PhoneInput value={form.phone} onChange={(v) => setForm((f) => ({ ...f, phone: v }))} />
                </div>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Email</label>
                  <input type="email" className={calcStyles.formControl} value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
                </div>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Address</label>
                  <input className={calcStyles.formControl} value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
                </div>
              </div>
              <div className={`${calcStyles.row} ${calcStyles.columns}`}>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Alternate Contact Name (optional)</label>
                  <input className={calcStyles.formControl} value={form.contactPerson} onChange={(e) => setForm((f) => ({ ...f, contactPerson: e.target.value }))} />
                </div>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Alternate Contact Phone (optional)</label>
                  <PhoneInput value={form.altContactPhone} onChange={(v) => setForm((f) => ({ ...f, altContactPhone: v }))} />
                </div>
              </div>
              <div className={`${calcStyles.row} ${calcStyles.columns}`}>
                {viewer?.isPrivileged && (
                  <div className={calcStyles.field}>
                    <label className={calcStyles.label}>Sales person</label>
                    <select className={calcStyles.formControl} value={form.salesPersonId} onChange={(e) => setForm((f) => ({ ...f, salesPersonId: e.target.value }))}>
                      <option value="">Defaults to you</option>
                      {assignableUsers.map((u) => (
                        <option key={u.id} value={u.id}>{u.name || u.username}</option>
                      ))}
                    </select>
                  </div>
                )}
                {isTechnicalCreator && (
                  <div className={calcStyles.field}>
                    <label className={calcStyles.label}>Sales person *</label>
                    <select required className={calcStyles.formControl} value={form.salesPersonId} onChange={(e) => setForm((f) => ({ ...f, salesPersonId: e.target.value }))}>
                      <option value="">Select the sales person</option>
                      {assignableUsers.map((u) => (
                        <option key={u.id} value={u.id}>{u.name || u.username}</option>
                      ))}
                    </select>
                    <span className={calcStyles.lockedHint}>The project will be theirs — you&apos;ll be added as its technical person.</span>
                  </div>
                )}
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Source *</label>
                  <ProjectSourceField required value={form.source} onChange={(v) => setForm((f) => ({ ...f, source: v }))} />
                </div>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Priority</label>
                  <select className={calcStyles.formControl} value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as ProjectPriority }))}>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>
              </div>
              <div className={`${calcStyles.row} ${calcStyles.columns}`}>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Expected closing date</label>
                  <input type="date" className={calcStyles.formControl} min={todayDateInputValue()} value={form.expectedClosingDate} onChange={(e) => setForm((f) => ({ ...f, expectedClosingDate: e.target.value }))} />
                </div>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Approx. Project Price (₹) *</label>
                  <input type="number" min={1} step="0.01" className={calcStyles.formControl} placeholder="e.g. 1250000" value={form.approxPrice} onChange={(e) => setForm((f) => ({ ...f, approxPrice: e.target.value }))} />
                </div>
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Remarks</label>
                <textarea className={calcStyles.formControl} rows={2} value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} />
              </div>
              <div className={`${notifyStyles.confirmActions} ${notifyStyles.confirmActionsSpaced}`}>
                <button type="button" className={notifyStyles.confirmCancel} onClick={() => close(null)}>Cancel</button>
                <button type="submit" className={notifyStyles.confirmOk} disabled={creating}>{creating ? 'Creating...' : 'Create Project'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </ProjectQuickCreateContext.Provider>
  );
}

// await openProjectQuickCreate({ clientName: '...' }) resolves with the new
// ProjectRecord on success, or null if the user cancels.
export function useProjectQuickCreate() {
  const open = useContext(ProjectQuickCreateContext);
  if (!open) throw new Error('useProjectQuickCreate must be used within a ProjectQuickCreateProvider');
  return open;
}
