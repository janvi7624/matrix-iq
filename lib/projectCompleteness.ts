// Lead -> Project automation — which fields an auto-created project is
// still missing before the assignee is considered done completing it.
// Computed on every read rather than persisted, so it can never drift out
// of sync with the real field values (no separate "completion status" to
// keep in step). Deliberately limited to fields that already exist on this
// model — `remarks` is reused as the general "additional project detail"
// field, same as the pre-existing manual Convert-to-Project flow already
// uses it for.
//
// Pure/dependency-free on purpose (no `db`/Sequelize import) so both
// server code (lib/projectStore.ts) and client components
// (components/ProjectDetailView.tsx) can import it directly — importing
// lib/projectStore.ts itself from a 'use client' component would try to
// bundle Sequelize/pg for the browser.
export interface ProjectCompleteness {
  isComplete: boolean;
  missingFields: Array<'approx_price' | 'expected_closing_date' | 'remarks'>;
}

export function checkProjectCompleteness(record: { approx_price: number | ''; expected_closing_date: string; remarks: string }): ProjectCompleteness {
  const missingFields: ProjectCompleteness['missingFields'] = [];
  if (record.approx_price === '' || record.approx_price === null || record.approx_price === undefined) missingFields.push('approx_price');
  if (!record.expected_closing_date) missingFields.push('expected_closing_date');
  if (!record.remarks || !record.remarks.trim()) missingFields.push('remarks');
  return { isComplete: missingFields.length === 0, missingFields };
}
