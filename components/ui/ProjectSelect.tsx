'use client';

import { useEffect, useState } from 'react';
import { ProjectRecord } from '@/lib/types';
import { useProjectQuickCreate } from './ProjectQuickCreateDialog';
import calcStyles from '../calculator.module.css';

const ADD_NEW_VALUE = '__add_new__';

interface ProjectSelectProps {
  value: string;
  // Called with the full record (not just the id) on both a normal selection
  // and a successful quick-create, so the caller can refresh whatever
  // display-only fields it shows (client name, company, address, ...)
  // directly from the fresh record instead of a second fetch. `project` is
  // null only when the user picks the empty "no project" option.
  onChange: (projectId: string, project: ProjectRecord | null) => void;
  required?: boolean;
  placeholder?: string;
  className?: string;
}

// Self-fetching shared project picker with a trailing "+ Add New Project"
// option — replaces every module's own hand-rolled fetch('/api/projects') +
// local <select>. Selection only: this never edits an already-selected
// project's fields, that stays exclusive to components/ProjectDetailView.tsx.
export default function ProjectSelect({ value, onChange, required, placeholder = '— Select project —', className }: ProjectSelectProps) {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const openQuickCreate = useProjectQuickCreate();

  useEffect(() => {
    fetch('/api/projects')
      .then((r) => (r.ok ? r.json() : []))
      .then(setProjects)
      .catch(() => setProjects([]));
  }, []);

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    if (next === ADD_NEW_VALUE) {
      e.target.value = value;
      const created = await openQuickCreate();
      if (created) {
        setProjects((prev) => [created, ...prev]);
        onChange(created.id, created);
      }
      return;
    }
    const project = projects.find((p) => p.id === next) || null;
    onChange(next, project);
  }

  return (
    <select className={className || calcStyles.formControl} value={value} onChange={handleChange} required={required}>
      <option value="">{placeholder}</option>
      {projects.map((p) => (
        <option key={p.id} value={p.id}>{p.client_name || ''}{p.company ? ` — ${p.company}` : ''}</option>
      ))}
      <option value={ADD_NEW_VALUE}>+ Add New Project</option>
    </select>
  );
}
