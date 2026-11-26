'use client';

import { ReactNode } from 'react';
import { RefreshCw, X } from 'lucide-react';
import CommonButton from './CommonButton';
import { CommonChipGroup } from './CommonChip';
import styles from './listControls.module.css';

/**
 * The standard header row of a list page:
 *   [quick-filter chips …………………] [⟳ refresh] [primary action]
 * Left wraps; right stays pinned to the right edge.
 */
export function ListToolbar({ left, right, className }: { left?: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={[styles.toolbar, className || ''].filter(Boolean).join(' ')}>
      <div className={styles.left}>{left}</div>
      {right && <div className={styles.right}>{right}</div>}
    </div>
  );
}

export interface QuickFilterOption<V extends string> {
  value: V;
  label: string;
  /** Shown as a badge on the chip. */
  count?: number;
  title?: string;
}

/**
 * Single-choice "views" of a list (All · Due today · Overdue …) as chips with
 * counts. Exactly one is always selected — start on the unfiltered one ("All").
 */
export function QuickFilters<V extends string>({
  options,
  value,
  onChange,
  ariaLabel = 'Quick filters'
}: {
  options: QuickFilterOption<V>[];
  value: V;
  onChange: (value: V) => void;
  ariaLabel?: string;
}) {
  return (
    <CommonChipGroup<V>
      ariaLabel={ariaLabel}
      className={styles.quick}
      showCheck={false}
      value={value}
      onChange={(v) => {
        if (v !== null) onChange(v);
      }}
      options={options.map((o) => ({ value: o.value, label: o.label, count: o.count, title: o.title }))}
    />
  );
}

/** Icon-only refresh, spinning while a reload is in flight. Goes in ListToolbar's `right`. */
export function RefreshButton({
  onRefresh,
  loading = false,
  label = 'Refresh',
  pushRight = false
}: {
  onRefresh: () => void;
  loading?: boolean;
  label?: string;
  /** Inside a flex row (a FilterBar/toolbar): push to the right end. */
  pushRight?: boolean;
}) {
  return (
    <CommonButton
      variant="outlined"
      size="sm"
      iconOnly
      leadingIcon={<RefreshCw />}
      aria-label={label}
      title={label}
      aria-busy={loading || undefined}
      className={[loading ? styles.spin : '', pushRight ? styles.pushRight : ''].filter(Boolean).join(' ') || undefined}
      onClick={onRefresh}
    />
  );
}

export interface DateRange {
  from: string; // yyyy-mm-dd or ''
  to: string;
}

/** True when `iso` (yyyy-mm-dd, possibly empty) falls inside the range. An empty range matches everything; an empty date matches only an empty range. */
export function inDateRange(iso: string | null | undefined, range: DateRange): boolean {
  if (!range.from && !range.to) return true;
  if (!iso) return false;
  const d = iso.slice(0, 10);
  if (range.from && d < range.from) return false;
  if (range.to && d > range.to) return false;
  return true;
}

/**
 * Optional date range — empty (no filtering) by default. Either end may be
 * left open ("from 1 Nov", "until 30 Nov").
 */
export function DateRangeFilter({
  value,
  onChange,
  label = 'Date'
}: {
  value: DateRange;
  onChange: (value: DateRange) => void;
  label?: string;
}) {
  const active = Boolean(value.from || value.to);
  return (
    <div className={styles.range} role="group" aria-label={`${label} range`}>
      <span className={styles.rangeLabel}>{label}</span>
      <input
        type="date"
        className={styles.rangeInput}
        aria-label={`${label} from`}
        value={value.from}
        max={value.to || undefined}
        onChange={(e) => onChange({ ...value, from: e.target.value })}
      />
      <span className={styles.rangeSep} aria-hidden="true">→</span>
      <input
        type="date"
        className={styles.rangeInput}
        aria-label={`${label} to`}
        value={value.to}
        min={value.from || undefined}
        onChange={(e) => onChange({ ...value, to: e.target.value })}
      />
      {active && (
        <CommonButton variant="ghost" size="sm" iconOnly leadingIcon={<X />} aria-label={`Clear ${label.toLowerCase()} range`} title="Clear" onClick={() => onChange({ from: '', to: '' })} />
      )}
    </div>
  );
}

/** "Clear filters" — renders only when something is filtered. */
export function ClearFiltersButton({ visible, onClear }: { visible: boolean; onClear: () => void }) {
  if (!visible) return null;
  return (
    <CommonButton variant="ghost" size="sm" leadingIcon={<X />} onClick={onClear}>
      Clear filters
    </CommonButton>
  );
}
