'use client';

import { useMemo, useState } from 'react';
import { Search, X, Check } from 'lucide-react';
import calcStyles from '../calculator.module.css';

export interface PersonPickerOption {
  id: string;
  username: string;
  name: string;
  department: string;
  role: string;
}

interface PersonPickerProps {
  options: PersonPickerOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  multiple?: boolean;
  placeholder?: string;
  // Maps a role key (e.g. 'engineer') to its display label (e.g. 'Engineer')
  // — callers pass TMS_ROLE_LABEL / a similar map so this component stays
  // domain-agnostic (not TMS-specific) despite being built for TMS first.
  roleLabel?: (role: string) => string;
  emptyMessage?: string;
}

// Search-box + result-card picker — the explicit alternative to "a huge
// plain dropdown" (this codebase's existing person-pickers, e.g. Sales
// person on Projects, are plain <select> elements; this is the first
// searchable one, built for TMS's Tahir-findability problem, generic
// enough to reuse anywhere a short list of colleagues needs picking).
export default function PersonPicker({ options, selectedIds, onChange, multiple = false, placeholder = 'Search…', roleLabel, emptyMessage = 'No matching people found.' }: PersonPickerProps) {
  const [query, setQuery] = useState('');

  const selected = useMemo(() => options.filter((o) => selectedIds.includes(o.id)), [options, selectedIds]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((o) => `${o.name} ${o.username} ${o.department} ${o.role}`.toLowerCase().includes(needle));
  }, [options, query]);

  function toggle(id: string) {
    if (multiple) {
      onChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
    } else {
      onChange(selectedIds.includes(id) ? [] : [id]);
    }
  }

  function remove(id: string) {
    onChange(selectedIds.filter((x) => x !== id));
  }

  return (
    <div>
      {selected.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {selected.map((p) => (
            <span
              key={p.id}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600,
                padding: '4px 6px 4px 10px', borderRadius: 'var(--mx-radius-full)',
                background: 'var(--mx-brand-subtle)', color: 'var(--mx-brand-hover)'
              }}
            >
              {p.name || p.username}
              <button
                type="button"
                onClick={() => remove(p.id)}
                aria-label={`Remove ${p.name || p.username}`}
                style={{ display: 'inline-flex', border: 'none', background: 'none', cursor: 'pointer', padding: 2, color: 'inherit' }}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div style={{ position: 'relative', marginBottom: 8 }}>
        <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--mx-ink-faint)' }} />
        <input
          type="text"
          className={calcStyles.formControl}
          style={{ paddingLeft: 32 }}
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--mx-border)', borderRadius: 'var(--mx-radius-sm)' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: '16px 12px', textAlign: 'center', fontSize: 13, color: 'var(--mx-ink-faint)' }}>{emptyMessage}</div>
        ) : (
          filtered.map((p) => {
            const isSelected = selectedIds.includes(p.id);
            return (
              <button
                type="button"
                key={p.id}
                onClick={() => toggle(p.id)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
                  padding: '10px 12px', border: 'none', borderBottom: '1px solid var(--mx-border)',
                  background: isSelected ? 'var(--mx-brand-subtle)' : 'var(--mx-surface)', cursor: 'pointer', textAlign: 'left'
                }}
              >
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--mx-ink)' }}>{p.name || p.username}</div>
                  <div style={{ fontSize: 12, color: 'var(--mx-ink-muted)' }}>
                    {p.department}{p.department && ' · '}{roleLabel ? roleLabel(p.role) : p.role}
                  </div>
                </div>
                {isSelected && <Check size={16} color="var(--mx-brand)" />}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
