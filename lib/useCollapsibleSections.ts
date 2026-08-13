'use client';

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'nav-section-state';

// Shared by Sidebar.tsx and Dashboard.tsx so a category's expand/collapse
// state stays in sync between the nav rail and the dashboard tile grid.
// Sections default to collapsed, except `initiallyExpandedLabel` (the
// viewer's department-matched category) which defaults open until the
// viewer explicitly toggles something — an explicit toggle always wins.
export function useCollapsibleSections(initiallyExpandedLabel?: string | null) {
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
        const next = { ...prev, [label]: !current };
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        return next;
      });
    },
    [initiallyExpandedLabel]
  );

  return { isExpanded, toggle };
}
