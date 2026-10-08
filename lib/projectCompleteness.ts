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
  missingFields: Array<'approx_price' | 'expected_closing_date' | 'remarks' | 'project_lead_id' | 'opportunity_type'>;
}

// What each missing field is CALLED, for anything that shows the list to a
// person: the panel on the project page and the reminder email both read this,
// so the email can never name a field by a different name than the page does.
export const PROJECT_FIELD_LABEL: Record<ProjectCompleteness['missingFields'][number], string> = {
  approx_price: 'Approx. Project Price',
  expected_closing_date: 'Expected Closing Date',
  remarks: 'Project Description / Remarks',
  project_lead_id: 'Project Lead / Mentor',
  opportunity_type: 'Opportunity Type'
};

export function checkProjectCompleteness(record: {
  approx_price: number | '';
  expected_closing_date: string;
  remarks: string;
  project_lead_id: string;
  opportunity_type: string;
}): ProjectCompleteness {
  const missingFields: ProjectCompleteness['missingFields'] = [];
  if (record.approx_price === '' || record.approx_price === null || record.approx_price === undefined) missingFields.push('approx_price');
  if (!record.expected_closing_date) missingFields.push('expected_closing_date');
  if (!record.remarks || !record.remarks.trim()) missingFields.push('remarks');
  // Mandatory on every project — an auto-created-from-lead one starts without
  // them (there's nobody to ask at assignment time), so it counts as
  // unfinished until the assignee picks the Opportunity Type and the Project
  // Lead / Mentor.
  if (!record.project_lead_id) missingFields.push('project_lead_id');
  if (!record.opportunity_type) missingFields.push('opportunity_type');
  // `departments` is deliberately NOT checked here: it is an optional field,
  // and the great majority of existing projects predate it — counting it as
  // missing would mark most of the pipeline incomplete over something nobody
  // was ever asked for.
  return { isComplete: missingFields.length === 0, missingFields };
}
