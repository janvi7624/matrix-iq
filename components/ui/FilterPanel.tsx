'use client';

import { ReactNode } from 'react';
import { ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react';
import styles from './filterPanel.module.css';

// A labelled, collapsible filter surface for views with too many filters to
// read as a flat FilterBar row. See filterPanel.module.css for why the
// Project Dashboard needed this instead of more FilterBar styling.
//
// Deliberately NOT a replacement for components/ui/FilterBar.tsx: a view with
// three or four filters reads fine as a single row and should keep using it.
// This is for the dozen-filter case.

export default function FilterPanel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={[styles.wrap, className || ''].filter(Boolean).join(' ')}>{children}</div>;
}

/** The always-visible top row: search, a couple of quick filters, the toggle. */
export function FilterPrimaryRow({ children }: { children: ReactNode }) {
  return <div className={styles.primaryRow}>{children}</div>;
}

/** Search box with a leading magnifier and a clear button once it has a value. */
export function FilterSearch({
  value,
  onChange,
  placeholder,
  label,
  id,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  label: string;
  id: string;
}) {
  return (
    <div className={styles.searchWrap}>
      <span className={styles.searchIcon}><Search size={16} /></span>
      <label className={styles.srOnly} htmlFor={id}>{label}</label>
      <input
        id={id}
        className={styles.searchInput}
        // type="search" rather than "text" so mobile keyboards show a search
        // key; the native clear affordance is suppressed by the custom button.
        type="search"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button type="button" className={styles.searchClear} onClick={() => onChange('')} aria-label={`Clear ${label.toLowerCase()}`}>
          <X size={15} />
        </button>
      )}
    </div>
  );
}

/**
 * Toggle for the field grid. `activeCount` is how many filters inside the
 * collapsed panel are currently set — shown as a badge so a collapsed panel
 * can never hide an applied filter without saying so.
 */
export function FilterToggle({
  open,
  onToggle,
  activeCount,
  controls,
}: {
  open: boolean;
  onToggle: () => void;
  activeCount: number;
  controls: string;
}) {
  return (
    <button
      type="button"
      className={[styles.toggleBtn, open ? styles.toggleBtnOpen : ''].filter(Boolean).join(' ')}
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controls}
    >
      <SlidersHorizontal size={15} />
      Filters
      {activeCount > 0 && <span className={styles.toggleBadge}>{activeCount}</span>}
      <span className={[styles.chevron, open ? styles.chevronOpen : ''].filter(Boolean).join(' ')}>
        <ChevronDown size={15} />
      </span>
    </button>
  );
}

/** The grid of captioned fields revealed by FilterToggle. */
export function FilterGrid({ id, children }: { id: string; children: ReactNode }) {
  return <div id={id} className={styles.panel}>{children}</div>;
}

/**
 * One captioned filter cell. `active` tints the caption and the control
 * inside it, so a set filter is visible without reading its value.
 *
 * `htmlFor` points the caption at the id of the control it names, rather than
 * wrapping the children in the <label> — a field can hold more than one
 * control (a preset select plus a revealed From/To pair), and a label may only
 * be associated with one. Controls beyond the first carry their own aria-label.
 */
export function FilterField({
  label,
  active,
  htmlFor,
  children,
}: {
  label: string;
  active: boolean;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.field} data-active={active ? 'true' : 'false'}>
      <label className={styles.fieldLabel} htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  );
}

/** A From/To pair inside one FilterField, so they read as a single range. */
export function FilterDatePair({ from, to, separator = 'to' }: { from: ReactNode; to: ReactNode; separator?: string }) {
  return (
    <span className={styles.datePair}>
      {from}
      <span className={styles.dateSep}>{separator}</span>
      {to}
    </span>
  );
}

/** Wrapper for a secondary range revealed under its own select in a field. */
export function FilterSubRange({ children }: { children: ReactNode }) {
  return <span className={styles.subRange}>{children}</span>;
}

export interface ActiveFilter {
  key: string;
  label: string;
  value: string;
  clear: () => void;
}

/**
 * Result count plus one removable chip per active filter. The chips are what
 * make collapsing the grid safe: every applied filter stays visible and
 * individually clearable even when its field is hidden.
 */
export function FilterMeta({
  count,
  activeFilters,
  onClearAll,
}: {
  count: ReactNode;
  activeFilters: ActiveFilter[];
  onClearAll: () => void;
}) {
  return (
    <div className={styles.metaRow}>
      <span className={styles.resultCount} role="status" aria-live="polite">{count}</span>
      {activeFilters.map((f) => (
        <span key={f.key} className={styles.chip}>
          <span className={styles.chipLabel}>{f.label}:</span>
          <span className={styles.chipValue} title={f.value}>{f.value}</span>
          <button type="button" className={styles.chipClear} onClick={f.clear} aria-label={`Clear ${f.label} filter`}>
            <X size={12} />
          </button>
        </span>
      ))}
      {activeFilters.length > 1 && (
        <button type="button" className={styles.clearAllBtn} onClick={onClearAll}>Clear all</button>
      )}
    </div>
  );
}

export { styles as filterPanelStyles };
