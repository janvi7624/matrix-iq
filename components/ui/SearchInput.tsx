'use client';

import { InputHTMLAttributes, useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import styles from './searchInput.module.css';

export interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'size' | 'type'> {
  value: string;
  /** Called with the new text — after `debounceMs` if set, otherwise on every keystroke. */
  onChange: (value: string) => void;
  /** Wait this long after typing stops before calling onChange (live-search lists). */
  debounceMs?: number;
  /** A key that focuses the box from anywhere on the page, e.g. "/". Shown as a hint. */
  shortcut?: string;
  /** Shows a small spinner (results are loading). */
  loading?: boolean;
  size?: 'md' | 'sm';
  /** Don't stretch to fill the row. */
  inline?: boolean;
  className?: string;
}

/**
 * The one search box for the app: search icon, clear (✕) button, optional
 * debounce, optional "/" shortcut, brand focus glow, and a tinted border
 * while it holds a query so an active search is easy to spot.
 */
export default function SearchInput({
  value,
  onChange,
  debounceMs = 0,
  shortcut,
  loading = false,
  size = 'md',
  inline = false,
  placeholder = 'Search…',
  className,
  ...rest
}: SearchInputProps) {
  const [draft, setDraft] = useState(value);
  const [lastValue, setLastValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Follow outside changes (e.g. "Clear filters") — adjusting state during render.
  if (value !== lastValue) {
    setLastValue(value);
    setDraft(value);
  }

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  useEffect(() => {
    if (!shortcut) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key === shortcut && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shortcut]);

  function emit(next: string, immediate = false) {
    setDraft(next);
    if (timer.current) clearTimeout(timer.current);
    if (!debounceMs || immediate) onChange(next);
    else timer.current = setTimeout(() => onChange(next), debounceMs);
  }

  const classes = [styles.root, size === 'sm' ? styles.sm : '', inline ? styles.inline : '', draft ? styles.hasValue : '', className || '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes}>
      <span className={styles.icon} aria-hidden="true">
        <Search />
      </span>
      <input
        {...rest}
        ref={inputRef}
        type="search"
        className={styles.input}
        value={draft}
        placeholder={placeholder}
        aria-label={rest['aria-label'] || (typeof placeholder === 'string' ? placeholder.replace(/…$/, '') : 'Search')}
        onChange={(e) => emit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && draft) {
            e.stopPropagation();
            emit('', true);
          }
          rest.onKeyDown?.(e);
        }}
      />
      <span className={styles.end}>
        {loading && <span className={styles.spinner} aria-hidden="true" />}
        {draft ? (
          <button
            type="button"
            className={styles.clear}
            aria-label="Clear search"
            title="Clear"
            onClick={() => {
              emit('', true);
              inputRef.current?.focus();
            }}
          >
            <X />
          </button>
        ) : (
          shortcut && <kbd className={styles.kbd}>{shortcut}</kbd>
        )}
      </span>
    </div>
  );
}
