// The Daily Report form engine: ONE schema-driven renderer/validator, eight
// department templates expressed as data.
//
// The alternative — a screen and a table per department — was explicitly
// rejected in the brief, and would have meant eight copies of the
// draft/submit/late/warning logic. So each department's report is a
// TemplateDefinition here, and a single component renders it while a single
// validator checks it on the server. Adding a ninth department's format is a
// new entry in BUILT_IN_TEMPLATES, not a new page.
//
// Three layouts cover every requested format, which is why there are three
// and not one:
//   'rows'      — many entries per day (HR, R&D, AI, Marketing, Robotics)
//   'narrative' — exactly one structured record per day (AV)
//   'matrix'    — a fixed measure × channel numeric grid (Sales / GEM Sales)
//
// Pure: no DB, no React, no env. The per-department ASSIGNMENT of a template
// (and any admin overrides to its dropdown options) lives in
// lib/dailyReportTemplateStore.ts; this file is the catalogue and the rules.

export type DailyReportTemplateKey = 'hr' | 'sales' | 'av' | 'rnd' | 'ai' | 'marketing' | 'robotics' | 'accounts' | 'backoffice' | 'not_configured';

export const TEMPLATE_KEYS: DailyReportTemplateKey[] = ['hr', 'sales', 'av', 'rnd', 'ai', 'marketing', 'robotics', 'accounts', 'backoffice', 'not_configured'];

export type DailyReportLayout = 'rows' | 'narrative' | 'matrix';

export type DailyReportFieldType =
  | 'text'
  | 'textarea'
  | 'select'
  | 'date'
  | 'number'
  // Server-computed and read-only in the UI — see `computed` below. Never
  // trusted from the client even if a value is posted for it.
  | 'computed';

/**
 * How a computed field's value is derived. Kept as a closed union rather
 * than a stored expression: these are business rules the backend has to
 * agree with (an overdue task must be overdue in analytics too), not
 * presentation sugar an admin should be able to retype.
 */
export type DailyReportComputedKind =
  /** Sequential per-report entry id, e.g. "AI-2026-10-14-03". */
  | 'entry_code'
  /** Whole days from the reporting date to this entry's due date; negative = overdue. */
  | 'days_left';

// There was briefly a third kind, 'serial', rendering a plain 1-based row
// number as Back Office's "Sr. No." column. It was removed once every
// row-based template gained a Task ID: an entry_code already ENDS in its
// position ("BO-2026-10-14-01"), so a separate Sr. No. was the same number
// shown twice, in two read-only columns, at the front of every row.

export interface DailyReportFieldDef {
  key: string;
  label: string;
  type: DailyReportFieldType;
  required?: boolean;
  /** For 'select'. Admin-overridable per department — see resolveTemplate(). */
  options?: string[];
  /**
   * Linked dropdown: this field's options are chosen by the value of
   * `dependsOn`. HR & Admin's Activity depends on Activity Category, so the
   * two can never be combined into a pair that doesn't exist.
   */
  dependsOn?: string;
  linkedOptions?: Record<string, string[]>;
  computed?: DailyReportComputedKind;
  placeholder?: string;
  maxLength?: number;
  /** Non-negative integers only — every numeric field in this module is a count. */
  integer?: boolean;
  /** Relative column width hint for the row/grid renderer. */
  width?: 'sm' | 'md' | 'lg' | 'xl';
  help?: string;
}

export interface TemplateDefinition {
  key: DailyReportTemplateKey;
  label: string;
  /**
   * Short prefix for this template's Task IDs, e.g. 'AI' -> AI-2026-10-14-01.
   *
   * Separate from `key` because the key is a storage identifier while this is
   * read by a person in a narrow column and quoted in conversation —
   * 'BACKOFFICE-2026-10-14-01' is neither. Defaults to the upper-cased key
   * when absent.
   */
  codePrefix?: string;
  description: string;
  layout: DailyReportLayout;
  /** Fields recorded once for the whole day (AV's narrative, a notes box). */
  headerFields: DailyReportFieldDef[];
  /** Fields repeated per entry. Empty unless layout is 'rows'. */
  rowFields: DailyReportFieldDef[];
  /** layout 'matrix' only — the fixed measure rows. */
  measures?: string[];
  /** layout 'matrix' only — the numeric columns that are summed. */
  channels?: string[];
  /** Minimum entries a SUBMITTED report must carry (drafts are never checked). */
  minEntries?: number;
  maxEntries?: number;
  /** Singular noun for the "Add <x>" button and validation messages. */
  entryNoun?: string;
}

// ---------------------------------------------------------------------------
// Shared option lists
// ---------------------------------------------------------------------------

// Deliberately per-template rather than one global STATUS list: Marketing is
// restricted to two values and Robotics has 'On Hold', and the brief said not
// to add status values to those without authorization. A single shared list
// would make the next edit silently widen all of them.
// Every template carries the same Task ID column — as the first rowFields
// entry for 'rows' templates (one per entry), or as the first headerFields
// entry for 'narrative'/'matrix' templates (AV, Sales — one per report, so
// index 0). Defined once rather than copied into each template so the label,
// width and help text cannot drift apart between departments — the whole
// point of the request was that it should be consistent everywhere.
const TASK_ID_FIELD: DailyReportFieldDef = {
  key: 'task_code',
  label: 'Task ID',
  type: 'computed',
  computed: 'entry_code',
  width: 'sm',
  help: 'Generated when the entry is saved.'
};

export const HR_STATUS_OPTIONS = ['In Progress', 'Completed', 'Pending'];
export const AI_STATUS_OPTIONS = ['In Progress', 'Completed', 'Pending'];
export const MARKETING_STATUS_OPTIONS = ['In Progress', 'Completed'];
export const ROBOTICS_STATUS_OPTIONS = ['In Progress', 'Completed', 'On Hold'];
export const PRIORITY_OPTIONS = ['Low', 'Medium', 'High', 'Critical'];

// HR & Admin's linked Category → Activity pairs. Seeded here and editable
// per department from Daily Report Configuration, so HR can add an activity
// without a deployment.
export const HR_ACTIVITY_CATALOGUE: Record<string, string[]> = {
  Recruitment: ['Job posting', 'Resume screening', 'Interview scheduling', 'Interview conducted', 'Offer rollout', 'Candidate follow-up'],
  Onboarding: ['Documentation', 'Induction session', 'Asset allocation', 'System access setup', 'Buddy assignment'],
  'Employee Relations': ['Grievance handling', 'One-on-one', 'Counselling', 'Exit interview', 'Engagement activity'],
  'Payroll & Compliance': ['Attendance reconciliation', 'Payroll input', 'PF / ESIC filing', 'Statutory register update', 'Reimbursement verification'],
  'Training & Development': ['Training needs analysis', 'Session delivery', 'Trainer coordination', 'Feedback collation'],
  Administration: ['Vendor coordination', 'Office upkeep', 'Travel booking', 'Courier / dispatch', 'Asset register update'],
  'Records & Reporting': ['Personnel file update', 'MIS preparation', 'Policy drafting', 'Audit support']
};

// The Accounts department's own activity list, exactly as the team supplied
// it. Flat rather than grouped by frequency (daily entries / monthly
// compliance / quarterly) because that is how they wrote it down, and a
// grouping they did not ask for would be a guess about their workflow.
//
// 'Other' is last and deliberate: an accountant whose day does not fit any
// of the twenty-one must still be able to file, and without an escape hatch
// the honest options are to lie or to skip the day. The Description field is
// required, so 'Other' always carries an explanation.
export const ACCOUNTS_ACTIVITY_OPTIONS = [
  'Sales entry',
  'Purchase entry',
  'Bank entry',
  'Cash entry',
  'Expense entry',
  'Payment follow-up (debtors)',
  'Payment to creditors',
  'Bank reconciliation',
  'GST return (GSTR-1, GSTR-3B)',
  'TDS payment',
  'PF / ESIC payment',
  'Salary',
  'Debtors and creditors list',
  'Stock statement',
  'Monthly P&L and Balance Sheet',
  'TDS return',
  'Advance tax',
  'Quarterly results',
  'Depreciation entry',
  'Stock verification',
  'Balance confirmation',
  'Other'
];

export const SALES_MEASURES = [
  'New Leads Generated',
  'Customer Calls',
  'Meetings Completed',
  'Meetings Scheduled',
  'Quotations Prepared',
  'Quotations Sent',
  'Purchase Orders Received',
  'Follow-ups Completed'
];

// The three product verticals a sales number is attributed to. Names match
// the company's existing TMS departments (lib/tmsConstants.ts) so the grid
// and the rest of the app mean the same thing by "AI" or "Robotics".
export const SALES_CHANNELS = ['AI', 'AV', 'Robotics'];

// ---------------------------------------------------------------------------
// The eight templates
// ---------------------------------------------------------------------------

const HR_TEMPLATE: TemplateDefinition = {
  key: 'hr',
  codePrefix: 'HR',
  label: 'HR Daily Activity Report',
  description: 'One row per activity handled today, categorised and tracked to a status.',
  layout: 'rows',
  entryNoun: 'Activity',
  minEntries: 1,
  headerFields: [],
  rowFields: [
    TASK_ID_FIELD,
    { key: 'category', label: 'Activity Category', type: 'select', required: true, options: Object.keys(HR_ACTIVITY_CATALOGUE), width: 'md' },
    { key: 'activity', label: 'Specific Activity', type: 'select', required: true, dependsOn: 'category', linkedOptions: HR_ACTIVITY_CATALOGUE, width: 'md' },
    { key: 'description', label: 'Description', type: 'textarea', required: true, maxLength: 2000, width: 'xl' },
    { key: 'priority', label: 'Priority', type: 'select', required: true, options: PRIORITY_OPTIONS, width: 'sm' },
    { key: 'status', label: 'Status', type: 'select', required: true, options: HR_STATUS_OPTIONS, width: 'sm' },
    { key: 'remarks', label: 'Remarks', type: 'textarea', maxLength: 1000, width: 'lg' }
  ]
};

const SALES_TEMPLATE: TemplateDefinition = {
  key: 'sales',
  codePrefix: 'SAL',
  label: 'Sales Daily Activity',
  description: 'Today’s activity counts per product vertical. Row, vertical and overall totals are calculated.',
  layout: 'matrix',
  measures: SALES_MEASURES,
  channels: SALES_CHANNELS,
  headerFields: [
    TASK_ID_FIELD,
    { key: 'notes', label: 'Notes', type: 'textarea', maxLength: 2000, placeholder: 'Context for today’s numbers — a large deal, a blocked follow-up, travel.', width: 'xl' }
  ],
  rowFields: []
};

const AV_TEMPLATE: TemplateDefinition = {
  key: 'av',
  codePrefix: 'AV',
  label: 'AV Daily Work Report',
  description: 'One structured site report per day — what was planned, what got done, and what is blocking.',
  layout: 'narrative',
  headerFields: [
    TASK_ID_FIELD,
    { key: 'location', label: 'Location / Site', type: 'text', required: true, maxLength: 255, width: 'lg' },
    { key: 'project_reference', label: 'Project / Client (optional)', type: 'text', maxLength: 255, width: 'lg', help: 'Free text — the project code or client name this day was spent on.' },
    { key: 'time_spent_hours', label: 'Time Spent (hours)', type: 'number', integer: false, width: 'sm' },
    { key: 'planned_work', label: 'Planned Work', type: 'textarea', required: true, maxLength: 4000, width: 'xl' },
    { key: 'completed_work', label: 'Completed Work', type: 'textarea', required: true, maxLength: 4000, width: 'xl' },
    { key: 'work_in_progress', label: 'Work in Progress', type: 'textarea', maxLength: 4000, width: 'xl' },
    { key: 'meetings', label: 'Meetings', type: 'textarea', maxLength: 4000, width: 'xl' },
    { key: 'issues', label: 'Issues / Challenges', type: 'textarea', maxLength: 4000, width: 'xl' },
    { key: 'support_required', label: 'Support Required', type: 'textarea', maxLength: 4000, width: 'xl' }
  ],
  rowFields: []
};

const RND_TEMPLATE: TemplateDefinition = {
  key: 'rnd',
  codePrefix: 'RND',
  label: 'R&D Daily Task Sheet',
  description: 'Technical progress per task, with the business impact and anything blocking it.',
  layout: 'rows',
  entryNoun: 'Task',
  minEntries: 1,
  headerFields: [],
  rowFields: [
    TASK_ID_FIELD,
    { key: 'task_description', label: 'Task Description', type: 'textarea', required: true, maxLength: 2000, width: 'xl' },
    { key: 'impact', label: 'Impact on Company', type: 'textarea', required: true, maxLength: 2000, width: 'lg' },
    { key: 'time_spent_hours', label: 'Time Spent (hours)', type: 'number', required: true, width: 'sm' },
    { key: 'blockers', label: 'Blockers', type: 'textarea', maxLength: 2000, width: 'lg' },
    { key: 'project', label: 'Project / Experiment', type: 'text', maxLength: 255, width: 'md' },
    { key: 'notes', label: 'Notes', type: 'textarea', maxLength: 1000, width: 'lg' }
  ]
};

const AI_TEMPLATE: TemplateDefinition = {
  key: 'ai',
  codePrefix: 'AI',
  label: 'AI Daily Task Sheet',
  description: 'Task-level tracking with priority, due date and an automatically calculated days-left.',
  layout: 'rows',
  entryNoun: 'Task',
  minEntries: 1,
  headerFields: [],
  rowFields: [
    TASK_ID_FIELD,
    { key: 'task_description', label: 'Task Description', type: 'textarea', required: true, maxLength: 2000, width: 'xl' },
    { key: 'project', label: 'Project / Category', type: 'text', required: true, maxLength: 255, width: 'md' },
    { key: 'priority', label: 'Priority', type: 'select', required: true, options: PRIORITY_OPTIONS, width: 'sm' },
    { key: 'status', label: 'Status', type: 'select', required: true, options: AI_STATUS_OPTIONS, width: 'sm' },
    { key: 'due_date', label: 'Due Date', type: 'date', required: true, width: 'sm' },
    { key: 'days_left', label: 'Days Left', type: 'computed', computed: 'days_left', width: 'sm', help: 'From the reporting date to the due date. Negative means overdue.' },
    { key: 'notes', label: 'Notes', type: 'textarea', maxLength: 1000, width: 'lg' }
  ]
};

const MARKETING_TEMPLATE: TemplateDefinition = {
  key: 'marketing',
  codePrefix: 'MKT',
  label: 'Marketing Daily Task Sheet',
  description: 'Task, status and due date. Status is deliberately limited to In Progress and Completed.',
  layout: 'rows',
  entryNoun: 'Task',
  minEntries: 1,
  headerFields: [],
  rowFields: [
    TASK_ID_FIELD,
    { key: 'task_description', label: 'Task Description', type: 'textarea', required: true, maxLength: 2000, width: 'xl' },
    { key: 'status', label: 'Status', type: 'select', required: true, options: MARKETING_STATUS_OPTIONS, width: 'sm' },
    { key: 'remark', label: 'Remark', type: 'textarea', maxLength: 1000, width: 'lg' },
    { key: 'due_date', label: 'Due Date', type: 'date', width: 'sm' }
  ]
};

const ROBOTICS_TEMPLATE: TemplateDefinition = {
  key: 'robotics',
  codePrefix: 'ROB',
  label: 'Robotics Daily Report',
  description: 'Per-task status as a dropdown, with free-text progress covering achievements, current work and challenges.',
  layout: 'rows',
  entryNoun: 'Task',
  minEntries: 1,
  headerFields: [],
  rowFields: [
    TASK_ID_FIELD,
    { key: 'project', label: 'Project / Client', type: 'text', required: true, maxLength: 255, width: 'md' },
    { key: 'task_details', label: 'Task Details', type: 'textarea', required: true, maxLength: 2000, width: 'xl' },
    { key: 'status', label: 'Status', type: 'select', required: true, options: ROBOTICS_STATUS_OPTIONS, width: 'sm' },
    { key: 'work_progress', label: 'Work Progress', type: 'textarea', required: true, maxLength: 4000, width: 'xl', help: 'What was achieved, what is being worked on now, and any challenges.' },
    { key: 'additional_activities', label: 'Additional Activities', type: 'textarea', maxLength: 2000, width: 'lg' }
  ]
};

const ACCOUNTS_TEMPLATE: TemplateDefinition = {
  key: 'accounts',
  codePrefix: 'ACC',
  label: 'Accounts Daily Activity',
  description: 'One row per accounting activity handled today, chosen from the standard list.',
  layout: 'rows',
  entryNoun: 'Activity',
  minEntries: 1,
  headerFields: [],
  rowFields: [
    TASK_ID_FIELD,
    { key: 'activity', label: 'Activity', type: 'select', required: true, options: ACCOUNTS_ACTIVITY_OPTIONS, width: 'md' },
    {
      key: 'description',
      label: 'Description',
      type: 'textarea',
      required: true,
      maxLength: 2000,
      width: 'xl',
      help: 'What was actually done. If you chose “Other”, say what the activity was.'
    },
    { key: 'remarks', label: 'Remarks', type: 'textarea', maxLength: 1000, width: 'lg' }
  ]
};

const BACKOFFICE_TEMPLATE: TemplateDefinition = {
  key: 'backoffice',
  codePrefix: 'BO',
  label: 'Back Office Daily Task Sheet',
  description: 'A numbered list of the tasks handled today, each with what was done and any remarks.',
  layout: 'rows',
  entryNoun: 'Task',
  minEntries: 1,
  headerFields: [],
  rowFields: [
    // Task ID only — no separate Sr. No. The id already ends in the row's
    // position, so the two were the same number in adjacent columns.
    TASK_ID_FIELD,
    // Free text rather than a dropdown: Back Office work is not drawn from a
    // fixed catalogue the way the Accounts activities are, so constraining it
    // to a list would mean either an unusable list or a permanent "Other".
    { key: 'task_name', label: 'Task Name', type: 'text', required: true, maxLength: 255, width: 'md' },
    { key: 'description', label: 'Description', type: 'textarea', required: true, maxLength: 2000, width: 'xl' },
    { key: 'remarks', label: 'Remarks', type: 'textarea', maxLength: 1000, width: 'lg' }
  ]
};

// Any department still awaiting a decision lands here. This is a real
// template key, not an absence of one, so that "this department has no
// approved format yet" is an explicit, queryable state: the scheduler skips
// it, the employee page explains itself instead of showing an empty form,
// and nobody is warned for not filing a report that was never specified.
const NOT_CONFIGURED_TEMPLATE: TemplateDefinition = {
  key: 'not_configured',
  label: 'Not configured',
  description: 'This department’s daily report format has not been approved yet. No report is expected, and no reminders or warnings are issued.',
  layout: 'narrative',
  headerFields: [],
  rowFields: []
};

export const BUILT_IN_TEMPLATES: Record<DailyReportTemplateKey, TemplateDefinition> = {
  hr: HR_TEMPLATE,
  sales: SALES_TEMPLATE,
  av: AV_TEMPLATE,
  rnd: RND_TEMPLATE,
  ai: AI_TEMPLATE,
  marketing: MARKETING_TEMPLATE,
  robotics: ROBOTICS_TEMPLATE,
  accounts: ACCOUNTS_TEMPLATE,
  backoffice: BACKOFFICE_TEMPLATE,
  not_configured: NOT_CONFIGURED_TEMPLATE
};

export function isTemplateKey(value: unknown): value is DailyReportTemplateKey {
  return typeof value === 'string' && (TEMPLATE_KEYS as string[]).includes(value);
}

/** True when a department holding this template owes a report at all. */
export function templateIsConfigured(key: DailyReportTemplateKey): boolean {
  return key !== 'not_configured';
}

// ---------------------------------------------------------------------------
// Default department → template mapping
// ---------------------------------------------------------------------------

// Department names are admin-editable free text (see Department Master, and
// lib/departmentStore.ts's findHrManagers comment — "HR" is actually called
// "HR & Admin" on this instance), so these are PREFIX/pattern rules rather
// than exact-string equality, and they only ever provide the FIRST-RUN
// default. Once a row exists in daily_report_templates, the admin's
// assignment wins and this list is never consulted for that department again.
const DEFAULT_TEMPLATE_RULES: { test: RegExp; template: DailyReportTemplateKey }[] = [
  { test: /^hr\b/i, template: 'hr' },
  // Both Sales departments feed the same pipeline and the same grid — see
  // LEAD_MANAGER_DEPARTMENTS in lib/permissions.ts for the same pairing.
  { test: /^gem\b.*sales|^sales\b/i, template: 'sales' },
  { test: /^av\b/i, template: 'av' },
  { test: /^(r&d|r and d|research)/i, template: 'rnd' },
  { test: /^ai\b/i, template: 'ai' },
  { test: /^marketing\b/i, template: 'marketing' },
  { test: /^robotics\b/i, template: 'robotics' },
  // Both of these were 'not_configured' until their formats were approved.
  // They now have one, so they map like every other department.
  { test: /^accounts\b/i, template: 'accounts' },
  { test: /^back\s*office\b/i, template: 'backoffice' }
];

/**
 * The template a department gets before an admin has assigned one.
 *
 * Everything unmatched — Administration, Purchase, Inventory, Management,
 * Technical — defaults to 'not_configured'. That is the safe direction: an unmapped
 * department produces no reminders and no warnings until someone decides,
 * rather than nagging a team for a report nobody designed.
 */
export function defaultTemplateForDepartment(departmentName: string): DailyReportTemplateKey {
  const name = (departmentName || '').trim();
  if (!name) return 'not_configured';
  const rule = DEFAULT_TEMPLATE_RULES.find((r) => r.test.test(name));
  return rule ? rule.template : 'not_configured';
}

// ---------------------------------------------------------------------------
// Per-department overrides
// ---------------------------------------------------------------------------

/**
 * What an admin may change about a built-in template without a deployment.
 * Deliberately narrow: dropdown option lists, the HR category→activity
 * catalogue, and the required-entry floor. The FIELD SET is not editable,
 * because the field keys are what analytics and the manager view read.
 */
export interface TemplateOverrides {
  /** fieldKey -> replacement option list, for 'select' fields. */
  options?: Record<string, string[]>;
  /** Replacement linked catalogue for a dependent field (HR's Activity). */
  linkedOptions?: Record<string, Record<string, string[]>>;
  minEntries?: number;
  /** Replaces the measure rows of a 'matrix' template. */
  measures?: string[];
  /** Replaces the numeric columns of a 'matrix' template. */
  channels?: string[];
}

/** A built-in template with this department's admin overrides applied. */
export function resolveTemplate(key: DailyReportTemplateKey, overrides?: TemplateOverrides | null): TemplateDefinition {
  const base = BUILT_IN_TEMPLATES[key] ?? NOT_CONFIGURED_TEMPLATE;
  if (!overrides) return base;

  const applyField = (field: DailyReportFieldDef): DailyReportFieldDef => {
    const nextOptions = overrides.options?.[field.key];
    const nextLinked = overrides.linkedOptions?.[field.key];
    if (!nextOptions?.length && !nextLinked) return field;
    return {
      ...field,
      ...(nextOptions?.length ? { options: nextOptions } : {}),
      ...(nextLinked ? { linkedOptions: nextLinked, options: Object.keys(nextLinked) } : {})
    };
  };

  return {
    ...base,
    headerFields: base.headerFields.map(applyField),
    rowFields: base.rowFields.map(applyField),
    ...(overrides.measures?.length ? { measures: overrides.measures } : {}),
    ...(overrides.channels?.length ? { channels: overrides.channels } : {}),
    ...(typeof overrides.minEntries === 'number' ? { minEntries: overrides.minEntries } : {})
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidationIssue {
  /** 'header.location' | 'entries.2.status' | 'matrix.Customer Calls.AV' | 'entries' */
  path: string;
  message: string;
}

export interface DailyReportPayloadInput {
  /** Header field values, keyed by field key. */
  header: Record<string, unknown>;
  /** Row entries for 'rows' templates, in display order. */
  entries: Record<string, unknown>[];
  /** measure -> channel -> count, for 'matrix' templates. */
  matrix: Record<string, Record<string, unknown>>;
}

export const EMPTY_PAYLOAD: DailyReportPayloadInput = { header: {}, entries: [], matrix: {} };

/** Hard cap so a single report can't be used to write an unbounded row set. */
export const MAX_ENTRIES_PER_REPORT = 100;

function asTrimmedString(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function validateField(field: DailyReportFieldDef, raw: Record<string, unknown>, pathPrefix: string, strict: boolean, issues: ValidationIssue[]): void {
  // Computed fields are derived server-side (see computeDerivedValues) — a
  // client-supplied value is ignored rather than validated or trusted.
  if (field.type === 'computed') return;

  const path = `${pathPrefix}.${field.key}`;
  const value = asTrimmedString(raw[field.key]);

  if (!value) {
    // Required-ness only bites on submit. A draft is a scratchpad by design
    // (see the brief's draft rules) and must be saveable half-finished.
    if (strict && field.required) issues.push({ path, message: `${field.label} is required.` });
    return;
  }

  if (field.maxLength && value.length > field.maxLength) {
    issues.push({ path, message: `${field.label} must be ${field.maxLength} characters or fewer.` });
  }

  if (field.type === 'number') {
    const num = Number(value);
    if (!Number.isFinite(num)) issues.push({ path, message: `${field.label} must be a number.` });
    else if (num < 0) issues.push({ path, message: `${field.label} cannot be negative.` });
    else if (field.integer !== false && !Number.isInteger(num)) issues.push({ path, message: `${field.label} must be a whole number.` });
    return;
  }

  if (field.type === 'date' && !isIsoDateLike(value)) {
    issues.push({ path, message: `${field.label} must be a valid date.` });
    return;
  }

  if (field.type === 'select') {
    // A dependent field validates against the list its parent selects, so
    // "Recruitment + Payroll input" is rejected rather than quietly stored.
    const allowed = field.dependsOn && field.linkedOptions ? field.linkedOptions[asTrimmedString(raw[field.dependsOn])] : field.options;
    if (!allowed) {
      issues.push({ path, message: `Choose ${field.label.toLowerCase()} after selecting a valid category.` });
      return;
    }
    if (!allowed.includes(value)) issues.push({ path, message: `${value} is not a valid ${field.label}.` });
  }
}

// Local to avoid importing dailyReportTime.ts here — these two files are
// deliberately independent, and a date field only needs the shape check.
function isIsoDateLike(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  return utc.getUTCFullYear() === y && utc.getUTCMonth() === m - 1 && utc.getUTCDate() === d;
}

/** True when an entry has nothing in it — such rows are dropped, not rejected. */
export function isBlankEntry(entry: Record<string, unknown>, template: TemplateDefinition): boolean {
  return template.rowFields.every((f) => f.type === 'computed' || !asTrimmedString(entry[f.key]));
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  /** The payload as it should be stored: trimmed, blank rows dropped. */
  normalized: DailyReportPayloadInput;
}

/**
 * The one validator. Called by every write path — employee draft, employee
 * submit, manager edit, manager file-for-them — because the brief requires
 * manager-filed reports to pass "the same validation", and because frontend
 * checks alone are not access control.
 *
 * `strict` is the draft/submit switch: false allows a half-filled report
 * through (draft), true enforces required fields and the minimum entry count
 * (submit).
 */
export function validateReportPayload(template: TemplateDefinition, input: DailyReportPayloadInput, strict: boolean): ValidationResult {
  const issues: ValidationIssue[] = [];
  const header: Record<string, unknown> = {};

  if (!templateIsConfigured(template.key)) {
    return {
      ok: false,
      issues: [{ path: 'template', message: 'This department’s daily report format is not configured yet, so a report cannot be filed.' }],
      normalized: EMPTY_PAYLOAD
    };
  }

  for (const field of template.headerFields) {
    validateField(field, input.header || {}, 'header', strict, issues);
    const value = asTrimmedString((input.header || {})[field.key]);
    if (field.type !== 'computed' && value) header[field.key] = field.type === 'number' ? Number(value) : value;
  }

  const entries: Record<string, unknown>[] = [];
  if (template.layout === 'rows') {
    const raw = Array.isArray(input.entries) ? input.entries : [];
    if (raw.length > MAX_ENTRIES_PER_REPORT) {
      issues.push({ path: 'entries', message: `A report can hold at most ${MAX_ENTRIES_PER_REPORT} entries.` });
    }
    raw.slice(0, MAX_ENTRIES_PER_REPORT).forEach((entry, index) => {
      const row = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
      // A blank row is what an untouched "Add row" leaves behind — silently
      // dropping it is kinder than making someone delete it to submit.
      if (isBlankEntry(row, template)) return;
      // The issue path uses the RAW index, not the position this row ends up
      // at in `entries`. Those differ as soon as a blank row sits before a
      // filled one — blanks are dropped from storage but the client is still
      // rendering them, so a compacted path would mark the error on the
      // wrong card. The client's array index is the only thing both sides
      // agree on.
      template.rowFields.forEach((field) => validateField(field, row, `entries.${index}`, strict, issues));
      const clean: Record<string, unknown> = {};
      template.rowFields.forEach((field) => {
        if (field.type === 'computed') return;
        const value = asTrimmedString(row[field.key]);
        if (value) clean[field.key] = field.type === 'number' ? Number(value) : value;
      });
      entries.push(clean);
    });

    const floor = template.minEntries ?? 0;
    if (strict && entries.length < floor) {
      issues.push({ path: 'entries', message: `Add at least ${floor} ${(template.entryNoun || 'entry').toLowerCase()}${floor === 1 ? '' : 's'} before submitting.` });
    }
  }

  const matrix: Record<string, Record<string, number>> = {};
  if (template.layout === 'matrix') {
    const measures = template.measures ?? [];
    const channels = template.channels ?? [];
    const rawMatrix = input.matrix && typeof input.matrix === 'object' ? input.matrix : {};
    let anyValue = false;
    for (const measure of measures) {
      const rawRow = (rawMatrix[measure] && typeof rawMatrix[measure] === 'object' ? rawMatrix[measure] : {}) as Record<string, unknown>;
      const row: Record<string, number> = {};
      for (const channel of channels) {
        const value = asTrimmedString(rawRow[channel]);
        if (!value) {
          // Blank means zero. Requiring 24 explicit zeros from a rep who had
          // a quiet day is how a daily form stops being filled in.
          row[channel] = 0;
          continue;
        }
        const num = Number(value);
        if (!Number.isFinite(num) || !Number.isInteger(num) || num < 0) {
          issues.push({ path: `matrix.${measure}.${channel}`, message: `${measure} / ${channel} must be a whole number of zero or more.` });
          row[channel] = 0;
          continue;
        }
        if (num > 0) anyValue = true;
        row[channel] = num;
      }
      matrix[measure] = row;
    }
    // Submitting an all-zero grid is almost always an accidental submit, so
    // it is blocked — but the notes field is an explicit escape hatch for a
    // genuinely zero day (training, travel, leave taken late in the day).
    if (strict && !anyValue && !asTrimmedString((input.header || {}).notes)) {
      issues.push({ path: 'matrix', message: 'Enter at least one number, or explain the zero day in Notes.' });
    }
  }

  return { ok: issues.length === 0, issues, normalized: { header, entries, matrix } };
}

// ---------------------------------------------------------------------------
// Derived values
// ---------------------------------------------------------------------------

export interface MatrixTotals {
  /** measure -> sum across channels. */
  byMeasure: Record<string, number>;
  /** channel -> sum across measures. */
  byChannel: Record<string, number>;
  overall: number;
}

export function computeMatrixTotals(template: TemplateDefinition, matrix: Record<string, Record<string, number>>): MatrixTotals {
  const measures = template.measures ?? [];
  const channels = template.channels ?? [];
  const byMeasure: Record<string, number> = {};
  const byChannel: Record<string, number> = {};
  let overall = 0;
  for (const channel of channels) byChannel[channel] = 0;
  for (const measure of measures) {
    let rowTotal = 0;
    for (const channel of channels) {
      const value = Number(matrix?.[measure]?.[channel]) || 0;
      rowTotal += value;
      byChannel[channel] += value;
    }
    byMeasure[measure] = rowTotal;
    overall += rowTotal;
  }
  return { byMeasure, byChannel, overall };
}

export interface DerivedEntryValues {
  task_code?: string;
  days_left?: number;
}

/**
 * The read-only columns: a stable per-entry code and days-left.
 *
 * Computed on the server at every read rather than stored, so that editing a
 * report's rows can't leave a stale "4 days left" behind, and so the days-left
 * an employee sees is the same arithmetic analytics uses to call a task
 * overdue. The code is positional within one report
 * ("AI-2026-10-14-03") — unique and meaningful in context without needing a
 * global sequence.
 */
export function computeDerivedValues(
  template: TemplateDefinition,
  reportDate: string,
  entry: Record<string, unknown>,
  index: number
): DerivedEntryValues {
  const derived: DerivedEntryValues = {};
  // Includes headerFields as well as rowFields: a 'narrative'/'matrix'
  // template (AV, Sales) has no repeating rows to attach a Task ID to, so its
  // Task ID — when it has one — lives in headerFields instead, computed the
  // same way at index 0 (there is exactly one "entry" per report in those
  // layouts). Every 'rows' template's headerFields is empty, so this is a
  // no-op for them.
  for (const field of [...template.headerFields, ...template.rowFields]) {
    if (field.computed === 'entry_code') {
      derived.task_code = `${template.codePrefix ?? template.key.toUpperCase()}-${reportDate}-${String(index + 1).padStart(2, '0')}`;
    }
    if (field.computed === 'days_left') {
      const due = asTrimmedString(entry.due_date);
      if (due && isIsoDateLike(due)) {
        const a = Date.UTC(Number(reportDate.slice(0, 4)), Number(reportDate.slice(5, 7)) - 1, Number(reportDate.slice(8, 10)));
        const b = Date.UTC(Number(due.slice(0, 4)), Number(due.slice(5, 7)) - 1, Number(due.slice(8, 10)));
        derived.days_left = Math.round((b - a) / 86_400_000);
      }
    }
  }
  return derived;
}

/** An entry whose due date has passed relative to its reporting date. */
export function isEntryOverdue(template: TemplateDefinition, reportDate: string, entry: Record<string, unknown>, index: number): boolean {
  const { days_left: daysLeft } = computeDerivedValues(template, reportDate, entry, index);
  if (typeof daysLeft !== 'number') return false;
  const status = asTrimmedString(entry.status);
  return daysLeft < 0 && status !== 'Completed';
}
