'use client';

import { useMemo, useState } from 'react';
import { Search, X, Check } from 'lucide-react';
import calcStyles from '../calculator.module.css';
import styles from './personPicker.module.css';

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
        <div className={styles.selectedRow}>
          {selected.map((p) => (
            <span
              key={p.id}
              className={styles.selectedChip}
            >
              {p.name || p.username}
              <button
                type="button"
                onClick={() => remove(p.id)}
                aria-label={`Remove ${p.name || p.username}`}
                className={styles.chipRemoveBtn}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className={styles.searchWrap}>
        <Search size={15} className={styles.searchIcon} />
        <input
          type="text"
          className={`${calcStyles.formControl} ${styles.searchInput}`}
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className={styles.resultsList}>
        {filtered.length === 0 ? (
          <div className={styles.emptyMessage}>{emptyMessage}</div>
        ) : (
          filtered.map((p) => {
            const isSelected = selectedIds.includes(p.id);
            return (
              <button
                type="button"
                key={p.id}
                onClick={() => toggle(p.id)}
                className={`${styles.resultRow} ${isSelected ? styles.resultRowSelected : ''}`}
              >
                <div>
                  <div className={styles.resultName}>{p.name || p.username}</div>
                  <div className={styles.resultMeta}>
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
