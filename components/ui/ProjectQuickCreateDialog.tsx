'use client';

import { FormEvent, createContext, useCallback, useContext, useEffect, useState } from 'react';
import { ProjectPriority, ProjectRecord } from '@/lib/types';
import { todayDateInputValue } from '@/lib/dateHelpers';
import PhoneInput from './PhoneInput';
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
  phone: string;
  email: string;
  address: string;
  salesPersonId: string;
  source: string;
  priority: ProjectPriority;
  expectedClosingDate: string;
  remarks: string;
}

const EMPTY_FORM: ProjectCreateForm = {
  clientName: '', company: '', contactPerson: '', phone: '', email: '', address: '',
  salesPersonId: '', source: '', priority: 'medium', expectedClosingDate: '', remarks: ''
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

  useEffect(() => {
    if (!pending) return;
    fetch('/api/users/list')
      .then((r) => (r.ok ? r.json() : []))
      .then((users: { id: string; username: string; name: string }[]) => setAssignableUsers(users))
      .catch(() => setAssignableUsers([]));
  }, [pending]);

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
    setCreating(true);
    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      if (!response.ok) throw new Error(String(response.status));
      const project: ProjectRecord = await response.json();
      toast.success('Project created.');
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
                  <label className={calcStyles.label}>Client name</label>
                  <input className={calcStyles.formControl} value={form.clientName} onChange={(e) => setForm((f) => ({ ...f, clientName: e.target.value }))} />
                </div>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Company</label>
                  <input className={calcStyles.formControl} value={form.company} onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))} />
                </div>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Contact person</label>
                  <input className={calcStyles.formControl} value={form.contactPerson} onChange={(e) => setForm((f) => ({ ...f, contactPerson: e.target.value }))} />
                </div>
              </div>
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
                  <label className={calcStyles.label}>Sales person</label>
                  <select className={calcStyles.formControl} value={form.salesPersonId} onChange={(e) => setForm((f) => ({ ...f, salesPersonId: e.target.value }))}>
                    <option value="">Defaults to you</option>
                    {assignableUsers.map((u) => (
                      <option key={u.id} value={u.id}>{u.name || u.username}</option>
                    ))}
                  </select>
                </div>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Source</label>
                  <input className={calcStyles.formControl} placeholder="Referral, website, cold call…" value={form.source} onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))} />
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
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Remarks</label>
                <textarea className={calcStyles.formControl} rows={2} value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} />
              </div>
              <div className={notifyStyles.confirmActions} style={{ marginTop: 18 }}>
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
