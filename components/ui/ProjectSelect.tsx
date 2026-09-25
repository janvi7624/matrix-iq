'use client';

import { useEffect, useRef, useState } from 'react';
import { ProjectRecord } from '@/lib/types';
import { useProjectQuickCreate } from './ProjectQuickCreateDialog';
import calcStyles from '../calculator.module.css';

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

function projectLabel(p: ProjectRecord): string {
  return `${p.client_name || ''}${p.company ? ` — ${p.company}` : ''}`;
}

// Self-fetching shared project picker with a trailing "+ Add New Project"
// option — replaces every module's own hand-rolled fetch('/api/projects') +
// local <select>. Selection only: this never edits an already-selected
// project's fields, that stays exclusive to components/ProjectDetailView.tsx.
//
// A type-to-filter combobox (same inline pattern as
// components/ui/TeamMemberSelect.tsx) rather than a plain native <select> —
// the project list grows without bound and scrolling a long <select> to find
// one client was the actual complaint. A hidden input carries the real
// `value` so a caller passing `required` still gets normal native form
// validation regardless of whatever text happens to be typed in the visible
// search box at submit time.
export default function ProjectSelect({ value, onChange, required, placeholder = '— Select project —', className }: ProjectSelectProps) {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const openQuickCreate = useProjectQuickCreate();

  useEffect(() => {
    fetch('/api/projects')
      .then((r) => (r.ok ? r.json() : []))
      .then(setProjects)
      .catch(() => setProjects([]));
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selected = projects.find((p) => p.id === value) || null;
  const q = query.trim().toLowerCase();
  const filtered = q
    ? projects.filter((p) => (p.client_name || '').toLowerCase().includes(q) || (p.company || '').toLowerCase().includes(q))
    : projects;

  function select(project: ProjectRecord | null) {
    onChange(project ? project.id : '', project);
    setOpen(false);
    setQuery('');
  }

  async function handleAddNew() {
    setOpen(false);
    const created = await openQuickCreate(query.trim() ? { clientName: query.trim() } : undefined);
    setQuery('');
    if (created) {
      setProjects((prev) => [created, ...prev]);
      onChange(created.id, created);
    }
  }

  return (
    <div ref={containerRef} className={calcStyles.teamMemberSelect}>
      <input
        type="text"
        className={className || calcStyles.formControl}
        placeholder={placeholder}
        value={open ? query : (selected ? projectLabel(selected) : '')}
        onFocus={() => { setOpen(true); setQuery(''); }}
        onChange={(e) => setQuery(e.target.value)}
      />
      {/* Carries the real selection for native form validation — the visible
          input above is search text, not the value, so it can't be trusted
          to reflect "a project is actually selected" on its own. */}
      <input type="text" value={value} required={required} onChange={() => {}} tabIndex={-1} aria-hidden style={{ position: 'absolute', width: 0, height: 0, opacity: 0, pointerEvents: 'none' }} />
      {open && (
        <div className={calcStyles.teamMemberSelectList}>
          {!q && (
            <button type="button" className={calcStyles.teamMemberSelectOption} onClick={() => select(null)}>
              {placeholder}
            </button>
          )}
          {filtered.length === 0 ? (
            <div className={calcStyles.teamMemberSelectEmpty}>No matches</div>
          ) : (
            filtered.map((p) => (
              <button key={p.id} type="button" className={calcStyles.teamMemberSelectOption} onClick={() => select(p)}>
                {projectLabel(p)}
              </button>
            ))
          )}
          <button type="button" className={calcStyles.teamMemberSelectOption} onClick={handleAddNew}>
            + Add New Project
          </button>
        </div>
      )}
    </div>
  );
}
