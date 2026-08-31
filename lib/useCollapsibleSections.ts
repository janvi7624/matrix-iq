'use client';

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'nav-section-state';
// Stable reference for callers that don't pass allLabels (Dashboard.tsx) —
// a fresh `[]` literal on every render would otherwise change toggle's
// useCallback dependency identity every render.
const EMPTY_LABELS: string[] = [];

// Shared by Sidebar.tsx and Dashboard.tsx so a category's expand/collapse
// state stays in sync between the nav rail and the dashboard tile grid.
// Sections default to collapsed, except `initiallyExpandedLabel` (the
// viewer's department-matched category) which defaults open until the
// viewer explicitly toggles something — an explicit toggle always wins.
//
// `accordion` (opt-in, Sidebar.tsx only — Dashboard.tsx's tile grid keeps
// its existing independent multi-expand behavior): opening one section
// explicitly collapses every other one, so exploring HR then clicking
// Marketing drops HR instead of leaving both open. Requires `allLabels` (the
// full set of section labels currently rendered) so every sibling — not just
// ones already toggled once — gets marked collapsed; otherwise a label with
// no explicit entry yet would fall through to the initiallyExpandedLabel
// default and reappear "open" alongside the newly clicked section.
export function useCollapsibleSections(initiallyExpandedLabel?: string | null, options?: { accordion?: boolean; allLabels?: string[] }) {
  const accordion = options?.accordion ?? false;
  const allLabels = options?.allLabels ?? EMPTY_LABELS;
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) setExpanded(JSON.parse(saved));
    } catch {
      // ignore malformed storage
    }
  }, []);

  const isExpanded = useCallback((label: string) => expanded[label] ?? label === initiallyExpandedLabel, [expanded, initiallyExpandedLabel]);

  const toggle = useCallback(
    (label: string) => {
      setExpanded((prev) => {
        const current = prev[label] ?? label === initiallyExpandedLabel;
        const opening = !current;
        const next =
          accordion && opening
            ? { ...Object.fromEntries(allLabels.map((l) => [l, false])), [label]: true }
            : { ...prev, [label]: !current };
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        return next;
      });
    },
    [initiallyExpandedLabel, accordion, allLabels]
  );

  return { isExpanded, toggle };
}
