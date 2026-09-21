'use client';

import { useEffect, useRef, useState } from 'react';
import calcStyles from '../calculator.module.css';

export interface TeamMemberOption {
  id: string;
  username: string;
  name: string;
  phone: string;
  email: string;
}

interface TeamMemberSelectProps {
  options: TeamMemberOption[];
  value: string; // selected user id
  onChange: (option: TeamMemberOption) => void;
  placeholder?: string;
}

// Inline searchable single-select — this codebase's existing pickers are
// either a plain native <select> (components/ui/ProjectSelect.tsx, fine for
// a short list) or a full-screen Ctrl+K palette (GlobalSearch.tsx, wrong
// shape for a form field) — neither fits "type to filter, pick one, inline
// in the form", so this is a small self-contained one rather than
// stretching either existing component to do something it wasn't built for.
export default function TeamMemberSelect({ options, value, onChange, placeholder = 'Search team member…' }: TeamMemberSelectProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.id === value);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q ? options.filter((o) => o.name.toLowerCase().includes(q) || o.username.toLowerCase().includes(q)) : options;

  return (
    <div ref={containerRef} className={calcStyles.teamMemberSelect}>
      <input
        type="text"
        className={calcStyles.formControl}
        placeholder={placeholder}
        value={open ? query : selected?.name || ''}
        onFocus={() => {
          setOpen(true);
          setQuery('');
        }}
        onChange={(e) => setQuery(e.target.value)}
      />
      {open && (
        <div className={calcStyles.teamMemberSelectList}>
          {filtered.length === 0 ? (
            <div className={calcStyles.teamMemberSelectEmpty}>No matches</div>
          ) : (
            filtered.map((o) => (
              <button
                key={o.id}
                type="button"
                className={calcStyles.teamMemberSelectOption}
                onClick={() => {
                  onChange(o);
                  setOpen(false);
                  setQuery('');
                }}
              >
                {o.name}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
