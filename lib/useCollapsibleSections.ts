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
// `accordion` (used by both Sidebar.tsx and Dashboard.tsx): opening one
// section explicitly collapses every other one, so exploring HR then
// clicking Marketing drops HR instead of leaving both open — without it the
// dashboard's eleven sections could all sit open at once. Requires `allLabels` (the
// full set of section labels currently rendered) so every sibling — not just
// ones already toggled once — gets marked collapsed; otherwise a label with
// no explicit entry yet would fall through to the initiallyExpandedLabel
// default and reappear "open" alongside the newly clicked section.
/**
 * Whether a section starts open, before anyone has toggled anything.
 *
 * A pure function, and exported, because the hook itself needs a DOM to run
 * and this suite has none (same split as lib/useAutoRefresh.ts's
 * shouldRefresh) — this is the part with the actual logic in it, and the part
 * that was wrong: with no `defaultExpanded` and a null `initiallyExpandedLabel`
 * every section answered false, which is how the Partner Portal's sidebar
 * came to render four collapsed headers and no nav links.
 */
export function sectionDefaultExpanded(
  label: string,
  options: { defaultExpanded?: boolean; initiallyExpandedLabel?: string | null }
): boolean {
  return Boolean(options.defaultExpanded) || label === options.initiallyExpandedLabel;
}

export function useCollapsibleSections(
  initiallyExpandedLabel?: string | null,
  options?: { accordion?: boolean; allLabels?: string[]; defaultExpanded?: boolean }
) {
  const accordion = options?.accordion ?? false;
  const allLabels = options?.allLabels ?? EMPTY_LABELS;
  // Start every section open instead of relying on initiallyExpandedLabel.
  //
  // For the Partner Portal, which has no department to match a section
  // against: primarySectionForDepartment(undefined) returns null, so nothing
  // equalled initiallyExpandedLabel and a partner's sidebar rendered four
  // collapsed headers and not one nav link. Picking a section to pre-expand
  // for them would be a guess; a partner's whole nav is 7 items across 4
  // sections, which fits on screen at once, so there is nothing to tame.
  const defaultExpanded = options?.defaultExpanded ?? false;
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) setExpanded(JSON.parse(saved));
    } catch {
      // ignore malformed storage
    }
  }, []);

  const defaultFor = useCallback(
    (label: string) => sectionDefaultExpanded(label, { defaultExpanded, initiallyExpandedLabel }),
    [defaultExpanded, initiallyExpandedLabel]
  );

  const isExpanded = useCallback((label: string) => expanded[label] ?? defaultFor(label), [expanded, defaultFor]);

  const toggle = useCallback(
    (label: string) => {
      setExpanded((prev) => {
        const current = prev[label] ?? defaultFor(label);
        const opening = !current;
        const next =
          accordion && opening
            ? { ...Object.fromEntries(allLabels.map((l) => [l, false])), [label]: true }
            : { ...prev, [label]: !current };
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        return next;
      });
    },
    [defaultFor, accordion, allLabels]
  );

  return { isExpanded, toggle };
}
