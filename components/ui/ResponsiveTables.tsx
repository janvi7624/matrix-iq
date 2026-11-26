'use client';

import { useEffect } from 'react';
import { columnLabels, rowCellLabels } from '@/lib/tableLabels';

const PHONE_QUERY = '(max-width: 640px)';
/** Set by this component; an explicit data-label written by a component is never overwritten. */
const AUTO_ATTR = 'data-label-auto';

function labelTable(table: HTMLTableElement) {
  const thead = table.tHead;
  if (!thead || !thead.rows.length) return;
  // The last header row holds the per-column headers when there are grouped rows above it.
  const labels = columnLabels(Array.from(thead.rows[thead.rows.length - 1].cells));
  const sections = [...Array.from(table.tBodies), ...(table.tFoot ? [table.tFoot] : [])];
  for (const section of sections) {
    for (const row of Array.from(section.rows)) {
      const cells = Array.from(row.cells);
      const rowLabels = rowCellLabels(cells, labels);
      cells.forEach((cell, i) => {
        const existing = cell.getAttribute('data-label');
        if (existing !== null && !cell.hasAttribute(AUTO_ATTR)) return; // set by the component itself
        if (existing === rowLabels[i]) return;
        cell.setAttribute('data-label', rowLabels[i]);
        cell.setAttribute(AUTO_ATTR, '');
      });
    }
  }
}

function labelAll() {
  document.querySelectorAll<HTMLTableElement>('table.mx-rtable').forEach(labelTable);
}

/**
 * Copies each table's column headers onto its cells as data-label, so the
 * phone card layout (app/globals.css → "Responsive tables") can show
 * "Label   value" per cell. Works for every table using the shared `.table`
 * class with no per-table code.
 *
 * Only active at phone width: it watches the DOM (rows arrive after data
 * loads, pages change) while the viewport is ≤640px, and does nothing at all
 * on larger screens. Renders nothing.
 */
export default function ResponsiveTables() {
  useEffect(() => {
    const mq = window.matchMedia(PHONE_QUERY);
    let observer: MutationObserver | null = null;
    let frame = 0;

    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        labelAll();
      });
    };

    const start = () => {
      if (observer) return;
      labelAll();
      observer = new MutationObserver(schedule);
      observer.observe(document.body, { childList: true, subtree: true });
    };
    const stop = () => {
      observer?.disconnect();
      observer = null;
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
    };
    const sync = () => (mq.matches ? start() : stop());

    sync();
    mq.addEventListener('change', sync);
    return () => {
      mq.removeEventListener('change', sync);
      stop();
    };
  }, []);

  return null;
}
