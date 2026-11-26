'use client';

import { CSSProperties, FocusEvent, KeyboardEvent, ReactNode, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, X } from 'lucide-react';
import SearchInput from './SearchInput';
import styles from './dropdown.module.css';

export interface DropdownOption<V extends string = string> {
  value: V;
  label: string;
  description?: string;
  icon?: ReactNode;
  /** Small count shown on the right (e.g. matching records). */
  count?: number;
  /** Options with the same group are listed under a heading. */
  group?: string;
  disabled?: boolean;
}

interface Common<V extends string> {
  options: DropdownOption<V>[];
  /** Text shown when nothing is selected — usually the "no filter" meaning, e.g. "All statuses". */
  placeholder?: string;
  /** Muted prefix inside the trigger, e.g. "Status" → "Status: Open". */
  label?: string;
  /** Icon at the start of the trigger. */
  icon?: ReactNode;
  /** Search box in the panel. Default: on when there are more than 8 options. */
  searchable?: boolean;
  /** Show a ✕ on the trigger to clear the selection. Default true. */
  clearable?: boolean;
  disabled?: boolean;
  size?: 'md' | 'sm';
  /** Stretch to the container width (forms). */
  fullWidth?: boolean;
  ariaLabel?: string;
  className?: string;
  id?: string;
  style?: CSSProperties;
  title?: string;
  /** Form field name — the value is submitted with the form (hidden field; one per value in multi mode). */
  name?: string;
  /** Native form validation: the form won't submit while nothing is selected. */
  required?: boolean;
  autoFocus?: boolean;
  onBlur?: (e: FocusEvent<HTMLButtonElement>) => void;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
}

/** Single-select (the default): multiselect/multiple omitted or false. */
export interface DropdownSingleProps<V extends string> extends Common<V> {
  /** Turn on multi-select. Default false ("multiple" is an alias). */
  multiselect?: false;
  multiple?: false;
  /** '' = nothing selected. */
  value: V | '';
  onChange: (value: V | '') => void;
}

/** Multi-select: multiselect (or its alias multiple) set to true. */
export type DropdownMultiProps<V extends string> = Common<V> & {
  value: V[];
  onChange: (value: V[]) => void;
} & ({ multiselect: true; multiple?: boolean } | { multiple: true; multiselect?: boolean });

export type DropdownProps<V extends string = string> = DropdownSingleProps<V> | DropdownMultiProps<V>;

/** True when the props ask for multi-select (either prop name). */
function isMulti<V extends string>(p: DropdownProps<V>): p is DropdownMultiProps<V> {
  return p.multiselect === true || p.multiple === true;
}

/** Text for the trigger: first selected label, plus how many more. Pure — exported for tests. */
export function summarizeSelection<V extends string>(options: DropdownOption<V>[], selected: V[]): { text: string; more: number } {
  if (!selected.length) return { text: '', more: 0 };
  const first = options.find((o) => o.value === selected[0]);
  return { text: first ? first.label : String(selected[0]), more: selected.length - 1 };
}

/** Options matching a search query (label, description or group; case/accent-insensitive). Pure — exported for tests. */
export function filterOptions<V extends string>(options: DropdownOption<V>[], query: string): DropdownOption<V>[] {
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const q = norm(query.trim());
  if (!q) return options;
  return options.filter((o) => norm(`${o.label} ${o.description || ''} ${o.group || ''}`).includes(q));
}

/** Filter helper: an empty selection means "no filter"; otherwise the value must be one of the chosen ones. */
export function inSelection<V extends string>(value: V | null | undefined, selected: readonly V[]): boolean {
  return selected.length === 0 || (value != null && selected.includes(value));
}

/**
 * The app's dropdown — single or multi-select, with search, grouping,
 * counts, Select all / Clear, full keyboard support, and a panel portalled
 * to <body> so tables and dialogs can't clip it.
 *
 * Filters: an empty selection means "no filter" (the placeholder, e.g.
 * "All statuses"). In multi mode a row matches when its value is in the set.
 */
export default function Dropdown<V extends string = string>(props: DropdownProps<V>) {
  const {
    options,
    placeholder = 'Select…',
    label,
    icon,
    clearable = true,
    disabled,
    size = 'md',
    fullWidth,
    ariaLabel,
    className,
    id,
    style,
    title,
    name,
    required,
    autoFocus,
    onBlur
  } = props;
  const multiple = isMulti(props);
  const selected: V[] = useMemo(
    () => (multiple ? (props.value as V[]) : props.value ? [props.value as V] : []),
    [multiple, props.value]
  );
  const searchable = props.searchable ?? options.length > 8;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const visible = useMemo(() => filterOptions(options, query), [options, query]);
  const enabledVisible = visible.filter((o) => !o.disabled);

  const close = useCallback((refocus = true) => {
    setOpen(false);
    setQuery('');
    setPos(null);
    if (refocus) triggerRef.current?.focus();
  }, []);

  // Position under the trigger (or above when there's no room below).
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const t = triggerRef.current?.getBoundingClientRect();
      const p = panelRef.current;
      if (!t || !p) return;
      const width = Math.max(t.width, 220);
      const h = p.offsetHeight;
      const below = t.bottom + 6;
      const top = below + h > window.innerHeight - 8 && t.top - 6 - h > 8 ? t.top - 6 - h : Math.min(below, window.innerHeight - h - 8);
      const left = Math.min(Math.max(8, t.left), window.innerWidth - Math.min(width, 420) - 8);
      setPos({ top: Math.max(8, top), left, width });
    };
    place();
  }, [open, visible.length]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: Event) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      close(false);
    };
    const onScroll = (e: Event) => {
      if (panelRef.current?.contains(e.target as Node)) return; // scrolling the list itself
      close(false);
    };
    const onResize = () => close(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, close]);

  // Keep the active option in view.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  function openPanel() {
    if (disabled) return;
    const firstSelected = visible.findIndex((o) => selected.includes(o.value));
    setActiveIndex(firstSelected >= 0 ? firstSelected : 0);
    setOpen(true);
  }

  function choose(o: DropdownOption<V>) {
    if (o.disabled) return;
    if (isMulti(props)) {
      const next = selected.includes(o.value) ? selected.filter((v) => v !== o.value) : [...selected, o.value];
      props.onChange(next);
    } else {
      props.onChange(o.value);
      close();
    }
  }

  function clearAll() {
    if (isMulti(props)) props.onChange([]);
    else props.onChange('');
  }

  function onKey(e: KeyboardEvent) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openPanel();
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      close(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(visible.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActiveIndex(visible.length - 1);
    } else if (e.key === 'Enter' || (e.key === ' ' && !searchable)) {
      e.preventDefault();
      const o = visible[activeIndex];
      if (o) choose(o);
    }
  }

  const { text, more } = summarizeSelection(options, selected);
  const hasValue = selected.length > 0;
  const triggerClasses = [
    styles.trigger,
    size === 'sm' ? styles.sm : '',
    fullWidth ? styles.full : '',
    open ? styles.open : '',
    hasValue && clearable ? styles.active : '',
    className || ''
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        className={triggerClasses}
        style={style}
        title={title}
        disabled={disabled}
        autoFocus={autoFocus}
        onBlur={onBlur}
        aria-labelledby={props['aria-labelledby']}
        aria-describedby={props['aria-describedby']}
        aria-invalid={props['aria-invalid']}
        aria-required={required || undefined}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel ? `${ariaLabel}: ${hasValue ? `${text}${more ? ` and ${more} more` : ''}` : placeholder}` : undefined}
        onClick={() => (open ? close(false) : openPanel())}
        onKeyDown={onKey}
      >
        {icon && (
          <span className={styles.lead} aria-hidden="true">
            {icon}
          </span>
        )}
        {label && hasValue && <span className={styles.label}>{label}</span>}
        <span className={`${styles.value} ${hasValue ? '' : styles.placeholder}`}>{hasValue ? text : placeholder}</span>
        {more > 0 && <span className={styles.more}>+{more}</span>}
        {hasValue && clearable && !disabled && (
          <span
            role="button"
            tabIndex={-1}
            aria-label="Clear selection"
            className={styles.clearBtn}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation();
              clearAll();
            }}
          >
            <X />
          </span>
        )}
        <span className={styles.chev} aria-hidden="true">
          <ChevronDown />
        </span>
      </button>
      {/* Form support: the value travels with the form like a native select's,
          and an empty required field blocks submit with the browser's own
          message (anchored here, right after the trigger). */}
      {(name || required) &&
        (multiple && selected.length > 0 ? (
          selected.map((v) => <input key={v} type="hidden" name={name} value={v} />)
        ) : (
          <input
            className={styles.formProxy}
            tabIndex={-1}
            aria-hidden="true"
            name={name}
            value={selected[0] ?? ''}
            required={required}
            disabled={disabled}
            onChange={() => {}}
            onFocus={() => triggerRef.current?.focus()}
          />
        ))}

      {open &&
        createPortal(
          <div
            ref={panelRef}
            className={styles.panel}
            style={pos ? { top: pos.top, left: pos.left, minWidth: pos.width } : { top: -9999, left: -9999 }}
            onKeyDown={onKey}
          >
            {searchable && (
              <div className={styles.panelSearch}>
                <SearchInput
                  size="sm"
                  value={query}
                  onChange={(q) => {
                    setQuery(q);
                    setActiveIndex(0);
                  }}
                  placeholder={`Search ${label ? label.toLowerCase() : 'options'}…`}
                  autoFocus
                />
              </div>
            )}
            <div
              ref={listRef}
              id={listId}
              role="listbox"
              aria-multiselectable={multiple || undefined}
              aria-label={ariaLabel || label || placeholder}
              aria-activedescendant={visible[activeIndex] ? `${listId}-${activeIndex}` : undefined}
              tabIndex={searchable ? -1 : 0}
              className={`${styles.list} mx-nice-scroll`}
            >
              {visible.length === 0 && <div className={styles.empty}>No matches</div>}
              {visible.map((o, i) => {
                const isSel = selected.includes(o.value);
                const heading = o.group && (i === 0 || visible[i - 1].group !== o.group) ? o.group : null;
                return (
                  <div key={o.value}>
                    {heading && <div className={styles.group}>{heading}</div>}
                    <div
                      id={`${listId}-${i}`}
                      data-index={i}
                      role="option"
                      aria-selected={isSel}
                      aria-disabled={o.disabled || undefined}
                      data-active={i === activeIndex}
                      className={styles.option}
                      onMouseEnter={() => setActiveIndex(i)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => choose(o)}
                    >
                      {multiple ? (
                        <span className={styles.box} aria-hidden="true">
                          <Check />
                        </span>
                      ) : (
                        <span className={styles.tick} aria-hidden="true">
                          {isSel && <Check />}
                        </span>
                      )}
                      {o.icon && <span className={styles.optIcon}>{o.icon}</span>}
                      <span className={styles.optText}>
                        <span className={styles.optLabel}>{o.label}</span>
                        {o.description && <span className={styles.optDesc}>{o.description}</span>}
                      </span>
                      {o.count !== undefined && <span className={styles.optCount}>{o.count}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
            {multiple && (
              <div className={styles.footer}>
                <span>{selected.length ? `${selected.length} selected` : 'None selected'}</span>
                <span className={styles.footerActions}>
                  <button
                    type="button"
                    className={styles.link}
                    disabled={!enabledVisible.length || enabledVisible.every((o) => selected.includes(o.value))}
                    onClick={() =>
                      isMulti<V>(props) &&
                      props.onChange([...new Set([...selected, ...enabledVisible.map((o) => o.value)])])
                    }
                  >
                    Select all
                  </button>
                  <button type="button" className={styles.link} disabled={!selected.length} onClick={clearAll}>
                    Clear
                  </button>
                </span>
              </div>
            )}
          </div>,
          document.body
        )}
    </>
  );
}
