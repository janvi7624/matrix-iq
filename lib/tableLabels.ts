// Pure helpers for the phone card layout of tables (see "Responsive tables"
// in app/globals.css and components/ui/ResponsiveTables.tsx). Kept DOM-light
// and free of React so they can be unit tested.

/** Minimal shape of a table cell this module needs (satisfied by HTMLTableCellElement). */
export interface CellLike {
  colSpan: number;
  textContent: string | null;
  getAttribute(name: string): string | null;
}

/** Text used as a column's label: aria-label/title first, else visible text, whitespace-collapsed. */
export function headerLabel(cell: CellLike): string {
  const explicit = cell.getAttribute('aria-label') || cell.getAttribute('title');
  const text = (explicit || cell.textContent || '').replace(/\s+/g, ' ').trim();
  // Sort arrows and similar glyph-only decorations aren't a label.
  return text.replace(/[▲▼↑↓⇅↕]+/g, '').trim();
}

/**
 * Expands a header row into one label per column, honouring colSpan, so a
 * header cell spanning 2 columns labels both of them.
 */
export function columnLabels(headerCells: CellLike[]): string[] {
  const out: string[] = [];
  for (const th of headerCells) {
    const label = headerLabel(th);
    const span = Math.max(1, th.colSpan || 1);
    for (let i = 0; i < span; i++) out.push(label);
  }
  return out;
}

/**
 * The label for each cell of a body row, by column position (colSpan aware).
 * A cell spanning more than one column gets '' (rendered full-width, unlabelled).
 */
export function rowCellLabels(rowCells: CellLike[], labels: string[]): string[] {
  const out: string[] = [];
  let col = 0;
  for (const td of rowCells) {
    const span = Math.max(1, td.colSpan || 1);
    out.push(span > 1 ? '' : labels[col] ?? '');
    col += span;
  }
  return out;
}
