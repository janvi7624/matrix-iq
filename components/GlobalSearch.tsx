'use client';

import { KeyboardEvent, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './ui/search.module.css';

interface SearchResult {
  type: 'project' | 'quotation' | 'lead' | 'site-visit';
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

const CATEGORY_LABEL: Record<SearchResult['type'], string> = {
  project: 'Project',
  quotation: 'Quotation',
  lead: 'Lead',
  'site-visit': 'Site Visit'
};
const CATEGORY_ICON: Record<SearchResult['type'], string> = {
  project: '📁',
  quotation: '🧾',
  lead: '📇',
  'site-visit': '📍'
};

const RECENT_KEY = 'mx-recent-searches';

// Self-contained: checks its own privilege (mirrors how Sidebar.tsx already
// fetches /api/auth/me independently) and renders nothing at all — no
// button, no Ctrl+K listener — for a non-privileged viewer, so a plain
// "user" login sees zero change to their header. Mounted once inside
// PortalHeader, which every AppShell page already renders.
export default function GlobalSearch() {
  const router = useRouter();
  const [privileged, setPrivileged] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { role?: string } | null) => {
        if (d?.role === 'admin' || d?.role === 'superadmin' || d?.role === 'manager') setPrivileged(true);
      })
      .catch(() => null);
  }, []);

  useEffect(() => {
    if (!privileged) return;
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [privileged]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setResults([]);
    setActiveIndex(0);
    try {
      setRecent(JSON.parse(window.localStorage.getItem(RECENT_KEY) || '[]'));
    } catch {
      setRecent([]);
    }
    const t = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    debounceRef.current = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`);
        const data: { results?: SearchResult[] } = response.ok ? await response.json() : {};
        setResults(data.results || []);
        setActiveIndex(0);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query, open]);

  function saveRecent(term: string) {
    if (!term) return;
    const next = [term, ...recent.filter((r) => r !== term)].slice(0, 5);
    setRecent(next);
    try {
      window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      // localStorage unavailable — recent searches just won't persist, not worth failing over
    }
  }

  function go(result: SearchResult) {
    saveRecent(query.trim());
    setOpen(false);
    router.push(result.href);
  }

  function handleInputKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter' && results[activeIndex]) {
      e.preventDefault();
      go(results[activeIndex]);
    }
  }

  if (!privileged) return null;

  const trimmed = query.trim();

  return (
    <>
      <button type="button" className={styles.trigger} onClick={() => setOpen(true)} aria-label="Search everything (Ctrl K)">
        <span>🔍</span>
        <span className={styles.triggerLabel}>Search…</span>
        <span className={styles.triggerKbd}>Ctrl K</span>
      </button>
      {open && (
        <div className={styles.overlay} onClick={() => setOpen(false)}>
          <div className={styles.palette} onClick={(e) => e.stopPropagation()}>
            <div className={styles.inputRow}>
              <span className={styles.inputIcon}>🔍</span>
              <input
                ref={inputRef}
                className={styles.input}
                placeholder="Search projects, quotations, leads, site visits…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleInputKeyDown}
              />
              <kbd className={styles.escHint}>Esc</kbd>
            </div>
            <div className={styles.results}>
              {loading && <div className={styles.hint}>Searching…</div>}
              {!loading && trimmed.length >= 2 && results.length === 0 && (
                <div className={styles.hint}>No matches for &quot;{trimmed}&quot;.</div>
              )}
              {!loading && trimmed.length < 2 && (
                recent.length > 0 ? (
                  <>
                    <div className={styles.groupLabel}>Recent</div>
                    {recent.map((term) => (
                      <button key={term} type="button" className={styles.resultRow} onClick={() => setQuery(term)}>
                        <span className={styles.resultIcon}>🕒</span>
                        <span className={styles.resultTitle}>{term}</span>
                      </button>
                    ))}
                  </>
                ) : (
                  <div className={styles.hint}>Type at least 2 characters to search projects, quotations, leads, and site visits.</div>
                )
              )}
              {!loading && results.map((r, i) => (
                <button
                  key={`${r.type}-${r.id}`}
                  type="button"
                  className={`${styles.resultRow} ${i === activeIndex ? styles.resultRowActive : ''}`}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => go(r)}
                >
                  <span className={styles.resultIcon}>{CATEGORY_ICON[r.type]}</span>
                  <span className={styles.resultMain}>
                    <span className={styles.resultTitle}>{r.title}</span>
                    <span className={styles.resultSubtitle}>{r.subtitle}</span>
                  </span>
                  <span className={styles.resultType}>{CATEGORY_LABEL[r.type]}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
