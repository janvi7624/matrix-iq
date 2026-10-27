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

export type DailyReportTemplateKey =
  | 'hr'
  | 'sales'
  | 'gem_sales'
  | 'av'
  | 'rnd'
  | 'ai'
  | 'marketing'
  | 'robotics'
  | 'accounts'
  | 'backoffice'
  | 'not_configured';

export const TEMPLATE_KEYS: DailyReportTemplateKey[] = [
  'hr',
  'sales',
  'gem_sales',
  'av',
  'rnd',
  'ai',
  'marketing',
  'robotics',
  'accounts',
  'backoffice',
  'not_configured'
];

export type DailyReportLayout = 'rows' | 'narrative' | 'matrix';

export type DailyReportFieldType =
  | 'text'
  | 'textarea'
  | 'select'
  | 'date'
  | 'time'
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
   * For 'select' — narrows what a PERSON can choose from in the dropdown,
   * while `options` (validateField's source of truth for what's a valid
   * stored value) stays the full set. Absent means the dropdown offers
   * everything in `options`, same as before this existed.
   *
   * Exists for a value nobody should be able to pick by hand but that a
   * system-generated row legitimately carries — GEM Sales' gem_team_activity
   * excludes 'Proposal Creation' here (see autoEntryActivity) while still
   * accepting it as a stored value, so an auto row renders correctly and a
   * person simply has no way to create one manually, rather than merely
   * finding it locked after the fact.
   */
  selectableOptions?: string[];
  /**
   * Linked dropdown: this field's options are chosen by the value of
   * `dependsOn`. HR & Admin's Activity depends on Activity Category, so the
   * two can never be combined into a pair that doesn't exist.
   */
  dependsOn?: string;
  linkedOptions?: Record<string, string[]>;
  /**
   * Conditional field: rendered, and required, ONLY when another field in
   * the same row/header satisfies this. Two modes, mutually exclusive:
   * `equals` (the original) shows it when the named field's value is one of
   * a finite list (AI's project_other, shown only for project==='Other');
   * `notEmpty` shows it whenever the named field holds ANY value — for a
   * field gated on something open-ended like a linked record's id, where
   * there's no fixed list to match against. Distinct from
   * dependsOn/linkedOptions above, which narrows a dropdown's options —
   * this hides the field outright.
   *
   * Honoured in both validateField (so the server never demands a field it
   * is not showing) and the form renderer, via the shared isFieldVisible
   * below. Those two must agree: a field required but hidden would make the
   * report impossible to submit.
   */
  showWhen?: { field: string; equals?: string[]; notEmpty?: boolean };
  /**
   * UI-only (read by components/DailyReportForm.tsx, not validateField):
   * when this field's value changes and that would blank an already-filled
   * dependsOn/showWhen dependent in the same row, the employee is asked to
   * confirm before the swap proceeds — rather than the usual silent clear
   * (see setEntry). Opt-in per field; every existing field defaults to the
   * original silent behaviour.
   */
  confirmOnChange?: boolean;
  computed?: DailyReportComputedKind;
  placeholder?: string;
  maxLength?: number;
  /** Non-negative integers only — every numeric field in this module is a count. */
  integer?: boolean;
  /** 'number' only — renders and is labelled as an INR amount. Storage and
   *  validation are unchanged; this is presentation only. */
  currency?: boolean;
  /** 'text' only — validated as a well-formed http(s) URL when non-blank. */
  format?: 'url';
  /**
   * 'time' or 'date' only — this field's value, if both it and the named
   * sibling field are present and valid, must not come before the
   * sibling's. 'time' is STRICT (must be strictly later — a meeting can't
   * start and end the same minute); 'date' is INCLUSIVE (may be the same
   * day — a one-day site visit has From == To). E.g. a "To" field naming
   * its "From" field.
   */
  afterField?: string;
  /**
   * Present in the stored entry and persisted like any other field, but
   * never rendered as an input — for system bookkeeping a row carries
   * alongside its visible fields (e.g. the source-record id an
   * autoEntryActivity row is linked to). Distinct from `computed`, which
   * IS rendered, just as read-only derived text.
   */
  hidden?: boolean;
  /**
   * Stays editable even on an auto/locked row (DailyReportForm.tsx's
   * isAutoRow — any hidden field non-empty). Every existing field defaults
   * to locked, matching GEM's all-locked auto rows exactly as before this
   * existed; set true only for a field whose value the SYSTEM never
   * supplies even on a linked row — AI's own daily notes on a TMS-linked
   * task, for one, which stays the employee's to write regardless of what
   * else on that row came from TMS.
   */
  editableWhenAuto?: boolean;
  /** Relative column width hint for the row/grid renderer. */
  width?: 'sm' | 'md' | 'lg' | 'xl';
  help?: string;
}

/**
 * Whether a conditional field should render at all, given its row/header's
 * current values. The one evaluation of `showWhen`, shared by the form
 * renderer and validateField so the two can never disagree about what's on
 * screen — see showWhen's own doc comment for why that matters.
 */
export function isFieldVisible(field: DailyReportFieldDef, row: Record<string, unknown>): boolean {
  if (!field.showWhen) return true;
  const raw = row[field.showWhen.field];
  if (field.showWhen.notEmpty) return String(raw ?? '').trim() !== '';
  return field.showWhen.equals?.includes(String(raw ?? '')) ?? false;
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
  /**
   * layout 'matrix' only — a subset of `measures` the system fills in itself
   * (lib/salesDailyAutoFetch.ts) from real Lead/Quotation/Project data, read-
   * only in the form. Every other measure stays a normal manual cell. Empty/
   * absent means "nothing is automated", the same as every template besides
   * Sales/GEM-Sales today.
   */
  autoMeasures?: string[];
  /** Minimum entries a SUBMITTED report must carry (drafts are never checked). */
  minEntries?: number;
  maxEntries?: number;
  /** Singular noun for the "Add <x>" button and validation messages. */
  entryNoun?: string;
  /**
   * layout 'rows' only — the value of the template's governing activity
   * field (gem_team_activity for GEM Sales) whose rows are auto-generated
   * from a real system record rather than typed by hand
   * (lib/gemProposalAutoFetch.ts, for GEM Sales' 'Proposal Creation', from
   * the day's own Quotation activity). Such a row carries a hidden id field
   * linking it back to its source record, is locked in the form, and is
   * re-derived fresh on every save — the rows-layout counterpart to
   * autoMeasures above. Absent means nothing is automated, same as every
   * rows template besides GEM Sales today.
   */
  autoEntryActivity?: string;
  /**
   * layout 'rows' only — this template's entries may be linked to a TMS
   * Task via a hidden tms_task_id field (added to its rowFields) rather
   * than typed by hand. Unlike autoEntryActivity, linking is a deliberate
   * per-entry choice the employee makes (components/TmsTaskPicker.tsx),
   * not a daily auto-pull of everything they touched — a TMS task spans
   * many days, so each day they still decide whether to report against it
   * again. See lib/aiTmsTaskLink.ts for the refresh that keeps a linked
   * row's TMS-sourced fields current on every save.
   */
  supportsTmsTaskLink?: boolean;
  /**
   * The auto-row badge's title text (DailyReportForm.tsx). Defaults to a
   * generic phrase when absent — set this when the generic wording
   * wouldn't name the real source correctly (GEM's rows come from a
   * quotation; AI's TMS-linked rows come from a TMS task).
   */
  autoRowHint?: string;
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
export const RND_STATUS_OPTIONS = ['In Progress', 'Completed', 'Pending'];
export const MARKETING_STATUS_OPTIONS = ['In Progress', 'Completed'];
export const ROBOTICS_STATUS_OPTIONS = ['In Progress', 'Completed', 'On Hold'];
export const PRIORITY_OPTIONS = ['Low', 'Medium', 'High', 'Critical'];

// AI sheet: what kind of work a task belongs to. "Other" is the only
// option that opens a free-text box (project_other below), so the common
// cases stay a clean two-click choice instead of free text everyone spells
// differently.
export const AI_PROJECT_CATEGORY_OPTIONS = ['Client', 'Internal', 'Other'];

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

// 'Quotations Sent' was a seventh measure here and is deliberately gone.
// It and 'Quotations Prepared' were read as the same thing on the floor —
// a quotation is sent the moment it is made — so the grid showed two columns
// with identical numbers in them. The one that remains counts EVERY
// quotation created that day, drafts included: it is the more generous of the
// two readings, and this grid is reviewed by HR, so a rep who saved a
// quotation without sending it should not read as having produced nothing.
// Already-submitted reports keep their stored 'Quotations Sent' figure in the
// matrix; it simply stops being displayed.
export const SALES_MEASURES = [
  'New Leads Generated',
  'Customer Calls',
  'Meetings Completed',
  'Meetings Scheduled',
  'Quotations Prepared',
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
  // The 6 measures with a real system of record, vs the 2 that stay manual.
  // Four come from Quotation/Lead records and two — Customer Calls and
  // Follow-ups Completed — from the call a rep logs on a lead (Leads -> Log
  // Call), via lib/leadCallDailyStats.ts. Only Meetings Completed and
  // Meetings Scheduled are still typed by hand: nothing in the app records a
  // meeting, so there is nothing to read them from.
  autoMeasures: [
    'New Leads Generated',
    'Customer Calls',
    'Quotations Prepared',
    'Purchase Orders Received',
    'Follow-ups Completed'
  ],
  headerFields: [
    TASK_ID_FIELD,
    { key: 'notes', label: 'Notes', type: 'textarea', maxLength: 2000, placeholder: 'Context for today’s numbers — a large deal, a blocked follow-up, travel.', width: 'xl' }
  ],
  rowFields: []
};

// GEM Sales — tender/bid-portal activity, a different business process from
// product Sales (government/B2B tender exploration, proposals, vendor
// follow-ups, bid submission, portal empanelment, document prep,
// communication, and in-office/on-site time) with no leads-or-quotations
// concept at all. One 'rows' template — one entry per activity logged that
// day, "Add Activity" already free from the generic rows engine — rather
// than nine separate forms: every activity-specific field is just the SAME
// row, with only the fields for the chosen GEM_ACTIVITY shown (showWhen).
//
// A handful of fields are intentionally NOT split per-activity even where
// the brief's required-ness or label varies slightly, to avoid inventing a
// field per activity for what is really the same concept — see each
// field's own comment for the specific simplification and why.
const GEM_ACTIVITY = {
  TENDER_EXPLORE: 'Tender Explore',
  PROPOSAL_CREATION: 'Proposal Creation',
  VENDOR_FOLLOWUP: 'Vendor Followup',
  BID_SUBMISSION: 'Bid Submission',
  EMPANELMENT: 'Empanelment',
  TENDER_DOCS: 'Tender Documents Preparation',
  COMMUNICATION: 'Communication',
  IN_OFFICE: 'In Office: Meeting / Training / Presentation / Activities',
  ONSITE: 'OnSite: Visit / Meeting / Demo'
} as const;

const GEM_QUALIFICATION_STATUS_OPTIONS = ['Qualified', 'Not Qualified', 'Under Evaluation', 'Pending'];
const GEM_FOLLOW_UP_METHOD_OPTIONS = ['Call', 'Email', 'WhatsApp', 'Meeting', 'Other'];
const GEM_SUBMISSION_STATUS_OPTIONS = ['In Progress', 'Submitted Successfully', 'Pending', 'Rejected', 'Technical Issue'];
const GEM_DOCUMENT_PREP_STATUS_OPTIONS = ['Not Started', 'In Progress', 'Pending Information', 'Ready for Review', 'Completed'];
const GEM_COMMUNICATION_WITH_OPTIONS = ['Client', 'Vendor', 'Internal Team', 'Other'];
const GEM_COMMUNICATION_MODE_OPTIONS = ['Call', 'Email', 'WhatsApp', 'Video Conference', 'In-Person', 'Other'];
const GEM_MEETING_TYPE_OPTIONS = ['Meeting', 'Training', 'Presentation', 'Internal Discussion', 'Review', 'Other'];
const GEM_PARTICIPANTS_OPTIONS = ['Internal Team', 'Client', 'Vendor'];
const GEM_YES_NO = ['Yes', 'No'];

// "Current Status" — same label, four different option sets, across the
// four activities that use it. One field (dependsOn + linkedOptions) rather
// than four, the same pattern HR_TEMPLATE already uses for Category ->
// Activity — showWhen still hides it entirely for every other activity.
const GEM_CURRENT_STATUS_OPTIONS: Record<string, string[]> = {
  [GEM_ACTIVITY.TENDER_EXPLORE]: ['Identified', 'Under Review', 'Qualified', 'Disqualified', 'On Hold', 'Completed'],
  [GEM_ACTIVITY.PROPOSAL_CREATION]: ['Not Started', 'In Progress', 'Internal Review', 'Sent to Client', 'Revision Required', 'Completed'],
  [GEM_ACTIVITY.VENDOR_FOLLOWUP]: ['Awaiting Response', 'Response Received', 'Negotiation', 'Follow-up Required', 'Completed'],
  [GEM_ACTIVITY.EMPANELMENT]: ['Not Started', 'Documents Pending', 'In Progress', 'Submitted', 'Under Review', 'Approved', 'Rejected']
};

const GEM_SALES_TEMPLATE: TemplateDefinition = {
  key: 'gem_sales',
  codePrefix: 'GEM',
  label: 'GEM Sales — Daily Activity Report',
  description: 'One row per tender/bid-portal activity logged today — fields change with the activity picked.',
  layout: 'rows',
  entryNoun: 'Activity',
  minEntries: 1,
  headerFields: [],
  // 'Proposal Creation' rows are auto-generated from the day's own
  // Quotation activity (lib/gemProposalAutoFetch.ts) and locked — no manual
  // entry for who/what/how-much, matching the Sales grid's auto-measures
  // precedent for the same reason (the system already has this data; typing
  // it again is both busywork and a second, driftable copy of the truth).
  autoEntryActivity: GEM_ACTIVITY.PROPOSAL_CREATION,
  autoRowHint: 'Filled in automatically from your quotation activity — not editable.',
  rowFields: [
    TASK_ID_FIELD,
    {
      key: 'gem_team_activity',
      label: 'GEM Team Activity',
      type: 'select',
      required: true,
      options: Object.values(GEM_ACTIVITY),
      // Proposal Creation is a valid STORED value (an auto-generated row
      // carries it) but not a CHOSEN one — excluded here so there is no way
      // to manually create a "Proposal Creation" activity that then sits
      // there editable; the only way one exists is the real thing, via
      // autoEntryActivity.
      selectableOptions: Object.values(GEM_ACTIVITY).filter((activity) => activity !== GEM_ACTIVITY.PROPOSAL_CREATION),
      width: 'lg',
      // Switching this after other fields are already filled in would
      // silently clear them (the same rule every showWhen field in this app
      // already follows) — but here that rule can erase a whole activity's
      // work by one misclick, so this one field asks first.
      confirmOnChange: true
    },

    // ---- Client / organization identity — shared where the label and
    // required-ness genuinely match; a differently-labelled or
    // differently-required variant gets its own field below instead of
    // forcing a mismatch onto this one. ----
    {
      key: 'client',
      label: 'Client',
      type: 'text',
      required: true,
      maxLength: 255,
      width: 'md',
      showWhen: { field: 'gem_team_activity', equals: [GEM_ACTIVITY.TENDER_EXPLORE, GEM_ACTIVITY.PROPOSAL_CREATION, GEM_ACTIVITY.BID_SUBMISSION] }
    },
    {
      // Simplification: the brief doesn't always mark Location required for
      // every activity it appears on (e.g. Vendor Followup, Communication)
      // — rather than a second near-duplicate field, it's required
      // everywhere it's shown. Being asked for a place is a low-friction
      // ask on a form about tender/vendor/site activity.
      key: 'location',
      label: 'Location',
      type: 'text',
      required: true,
      maxLength: 255,
      width: 'md',
      // PROPOSAL_CREATION is deliberately NOT in this list, even though it is
      // otherwise the same kind of activity.
      //
      // It is autoEntryActivity: its rows are generated from the day's
      // quotation activity and are LOCKED in the form. A quotation has no
      // site, so the auto-fetch has no location to write — which left a
      // required field, on a row nobody can type into, that nothing fills.
      // The report simply could not be submitted. Asking where a proposal was
      // written is meaningless anyway; the other seven activities are all
      // things that happen somewhere.
      showWhen: {
        field: 'gem_team_activity',
        equals: [
          GEM_ACTIVITY.TENDER_EXPLORE,
          GEM_ACTIVITY.VENDOR_FOLLOWUP,
          GEM_ACTIVITY.BID_SUBMISSION,
          GEM_ACTIVITY.EMPANELMENT,
          GEM_ACTIVITY.TENDER_DOCS,
          GEM_ACTIVITY.COMMUNICATION,
          GEM_ACTIVITY.ONSITE
        ]
      }
    },
    {
      // Simplification: required only for Bid Submission in the brief, a
      // plain text field for Tender Explore / Tender Documents Preparation.
      // Shared as one NOT-required field across all three rather than
      // splitting it — enforcing it everywhere would wrongly block a Tender
      // Explore entry filed before a reference number even exists yet.
      key: 'tender_reference_number',
      label: 'Tender Reference Number',
      type: 'text',
      maxLength: 120,
      width: 'md',
      showWhen: { field: 'gem_team_activity', equals: [GEM_ACTIVITY.TENDER_EXPLORE, GEM_ACTIVITY.BID_SUBMISSION, GEM_ACTIVITY.TENDER_DOCS] }
    },
    {
      key: 'project_value',
      label: 'Project Value (₹)',
      type: 'number',
      integer: false,
      currency: true,
      width: 'sm',
      showWhen: { field: 'gem_team_activity', equals: [GEM_ACTIVITY.TENDER_EXPLORE, GEM_ACTIVITY.PROPOSAL_CREATION, GEM_ACTIVITY.BID_SUBMISSION, GEM_ACTIVITY.TENDER_DOCS] }
    },
    {
      key: 'current_status',
      label: 'Current Status',
      type: 'select',
      dependsOn: 'gem_team_activity',
      linkedOptions: GEM_CURRENT_STATUS_OPTIONS,
      width: 'md',
      showWhen: { field: 'gem_team_activity', equals: [GEM_ACTIVITY.TENDER_EXPLORE, GEM_ACTIVITY.PROPOSAL_CREATION, GEM_ACTIVITY.VENDOR_FOLLOWUP, GEM_ACTIVITY.EMPANELMENT] }
    },
    {
      key: 'activity_brief',
      label: 'Activity Brief',
      type: 'textarea',
      required: true,
      maxLength: 2000,
      width: 'xl',
      showWhen: {
        field: 'gem_team_activity',
        equals: [GEM_ACTIVITY.TENDER_EXPLORE, GEM_ACTIVITY.PROPOSAL_CREATION, GEM_ACTIVITY.VENDOR_FOLLOWUP, GEM_ACTIVITY.BID_SUBMISSION, GEM_ACTIVITY.EMPANELMENT, GEM_ACTIVITY.TENDER_DOCS]
      }
    },

    // ---- Tender Explore only ----
    { key: 'due_date', label: 'Due Date', type: 'date', width: 'sm', showWhen: { field: 'gem_team_activity', equals: [GEM_ACTIVITY.TENDER_EXPLORE] } },
    {
      key: 'qualification_status',
      label: 'Qualification Status',
      type: 'select',
      options: GEM_QUALIFICATION_STATUS_OPTIONS,
      width: 'sm',
      showWhen: { field: 'gem_team_activity', equals: [GEM_ACTIVITY.TENDER_EXPLORE] }
    },

    // ---- Proposal Creation only — every field here is auto-filled from
    // the day's own Quotation activity (lib/gemProposalAutoFetch.ts) and
    // locked in the form, same as the Sales grid's auto measures. No field
    // here is typed by hand. ----
    {
      key: 'sales_person',
      label: 'Sales Person',
      type: 'text',
      required: true,
      maxLength: 255,
      width: 'md',
      showWhen: { field: 'gem_team_activity', equals: [GEM_ACTIVITY.PROPOSAL_CREATION] }
    },
    {
      // Links this row back to the quotation it was generated from —
      // what mergeAutoGemEntries matches on to update an already-saved
      // auto row rather than duplicating it, and what the form uses to
      // know which rows to lock.
      key: 'proposal_quotation_id',
      label: 'Quotation Reference',
      type: 'text',
      hidden: true,
      showWhen: { field: 'gem_team_activity', equals: [GEM_ACTIVITY.PROPOSAL_CREATION] }
    },

    // ---- Vendor Followup only ----
    {
      key: 'vendor_name',
      label: 'Vendor Name',
      type: 'text',
      required: true,
      maxLength: 255,
      width: 'md',
      showWhen: { field: 'gem_team_activity', equals: [GEM_ACTIVITY.VENDOR_FOLLOWUP] }
    },
    {
      key: 'client_project_name',
      label: 'Client / Project Name',
      type: 'text',
      maxLength: 255,
      width: 'md',
      showWhen: { field: 'gem_team_activity', equals: [GEM_ACTIVITY.VENDOR_FOLLOWUP] }
    },
    {
      key: 'proposal_tender_reference',
      label: 'Proposal / Tender Reference',
      type: 'text',
      maxLength: 120,
      width: 'md',
      showWhen: { field: 'gem_team_activity', equals: [GEM_ACTIVITY.VENDOR_FOLLOWUP] }
    },
    { key: 'follow_up_date', label: 'Follow-up Date', type: 'date', width: 'sm', showWhen: { field: 'gem_team_activity', equals: [GEM_ACTIVITY.VENDOR_FOLLOWUP] } },
    {
      key: 'follow_up_method',
      label: 'Follow-up Method',
      type: 'select',
      options: GEM_FOLLOW_UP_METHOD_OPTIONS,
      width: 'sm',
      showWhen: { field: 'gem_team_activity', equals: [GEM_ACTIVITY.VENDOR_FOLLOWUP] }
    },
    {
      key: 'vendor_next_follow_up_date',
      label: 'Next Follow-up Date',
      type: 'date',
      width: 'sm',
      showWhen: { field: 'gem_team_activity', equals: [GEM_ACTIVITY.VENDOR_FOLLOWUP] }
    },

    // ---- Bid Submission only ----
    { key: 'submission_date', label: 'Submission Date', type: 'date', width: 'sm', showWhen: { field: 'gem_team_activity', equals: [GEM_ACTIVITY.BID_SUBMISSION] } },
    {
      key: 'submission_status',
      label: 'Submission Status',
      type: 'select',
      options: GEM_SUBMISSION_STATUS_OPTIONS,
      width: 'sm',
      showWhen: { field: 'gem_team_activity', equals: [GEM_ACTIVITY.BID_SUBMISSION] }
    },
    {
      // Simplification: "optional file upload or reference link" — a real
      // upload needs this module's own storage wiring; a link covers the
      // explicitly-offered simpler alternative without that extra scope.
      key: 'submission_proof_link',
      label: 'Submission Proof / Acknowledgement (link)',
      type: 'text',
      format: 'url',
      maxLength: 500,
      width: 'lg',
      placeholder: 'https://…',
      showWhen: { field: 'gem_team_activity', equals: [GEM_ACTIVITY.BID_SUBMISSION] }
    },

    // ---- Empanelment only ----
    {
      key: 'client_organization',
      label: 'Client / Organization',
      type: 'text',
      required: true,
      maxLength: 255,
      width: 'md',
      showWhen: { field: 'gem_team_activity', equals: [GEM_ACTIVITY.EMPANELMENT] }
    },
    {
      key: 'empanelment_portal_link',
      label: 'Empanelment Portal Link',
      type: 'text',
      format: 'url',
      maxLength: 500,
      width: 'lg',
      placeholder: 'https://…',
      showWhen: { field: 'gem_team_activity', equals: [GEM_ACTIVITY.EMPANELMENT] }
    },
    {
      key: 'registration_reference',
      label: 'Registration / Application Reference',
      type: 'text',
      maxLength: 120,
      width: 'md',
      showWhen: { field: 'gem_team_activity', equals: [GEM_ACTIVITY.EMPANELMENT] }
    },

    // ---- Tender Documents Preparation only ----
    {
      key: 'documents_required',
      label: 'Documents Required / Prepared',
      type: 'textarea',
      maxLength: 2000,
      width: 'xl',
      showWhen: { field: 'gem_team_activity', equals: [GEM_ACTIVITY.TENDER_DOCS] }
    },
    {
      key: 'document_preparation_status',
      label: 'Document Preparation Status',
      type: 'select',
      options: GEM_DOCUMENT_PREP_STATUS_OPTIONS,
      width: 'sm',
      showWhen: { field: 'gem_team_activity', equals: [GEM_ACTIVITY.TENDER_DOCS] }
    },
    {
      key: 'submission_due_date',
      label: 'Submission Due Date',
      type: 'date',
      width: 'sm',
      showWhen: { field: 'gem_team_activity', equals: [GEM_ACTIVITY.TENDER_DOCS] }
    },

    // ---- Communication only ----
    {
      key: 'communication_with',
      label: 'Communication With',
      type: 'select',
      options: GEM_COMMUNICATION_WITH_OPTIONS,
      width: 'sm',
      showWhen: { field: 'gem_team_activity', equals: [GEM_ACTIVITY.COMMUNICATION] }
    },
    {
      key: 'contact_organization_name',
      label: 'Contact / Organization Name',
      type: 'text',
      maxLength: 255,
      width: 'md',
      showWhen: { field: 'gem_team_activity', equals: [GEM_ACTIVITY.COMMUNICATION] }
    },
    {
      key: 'communication_date',
      label: 'Communication Date',
      type: 'date',
      width: 'sm',
      showWhen: { field: 'gem_team_activity', equals: [GEM_ACTIVITY.COMMUNICATION] }
    },
    {
      key: 'communication_mode',
      label: 'Communication Mode',
      type: 'select',
      options: GEM_COMMUNICATION_MODE_OPTIONS,
      width: 'sm',
      showWhen: { field: 'gem_team_activity', equals: [GEM_ACTIVITY.COMMUNICATION] }
    },
    {
      key: 'comm_outcome_next_action',
      label: 'Outcome / Next Action',
      type: 'textarea',
      maxLength: 2000,
      width: 'lg',
      showWhen: { field: 'gem_team_activity', equals: [GEM_ACTIVITY.COMMUNICATION] }
    },
    {
      key: 'follow_up_required',
      label: 'Follow-up Required',
      type: 'select',
      options: GEM_YES_NO,
      width: 'sm',
      showWhen: { field: 'gem_team_activity', equals: [GEM_ACTIVITY.COMMUNICATION] }
    },
    {
      // Chained on follow_up_required rather than gem_team_activity
      // directly: follow_up_required itself only ever has a value under
      // Communication, so this is "Communication AND Yes" without a
      // multi-field showWhen the engine doesn't support.
      key: 'comm_next_follow_up_date',
      label: 'Next Follow-up Date',
      type: 'date',
      width: 'sm',
      showWhen: { field: 'follow_up_required', equals: ['Yes'] }
    },

    // ---- In Office / OnSite shared shape (purpose, outcome, next action —
    // but NOT the date/time range, which differs: In Office is a single day
    // with a time-of-day range, OnSite is a visit that can itself span more
    // than one day, so it gets a date range instead of a time-of-day one) ----
    {
      key: 'purpose_brief',
      label: 'Purpose Brief',
      type: 'textarea',
      required: true,
      maxLength: 2000,
      width: 'xl',
      showWhen: { field: 'gem_team_activity', equals: [GEM_ACTIVITY.COMMUNICATION, GEM_ACTIVITY.IN_OFFICE, GEM_ACTIVITY.ONSITE] }
    },

    // ---- In Office only: single day, time-of-day range ----
    {
      key: 'activity_date',
      label: 'Activity Date',
      type: 'date',
      width: 'sm',
      showWhen: { field: 'gem_team_activity', equals: [GEM_ACTIVITY.IN_OFFICE] }
    },
    {
      key: 'from_time',
      label: 'From',
      type: 'time',
      width: 'sm',
      showWhen: { field: 'gem_team_activity', equals: [GEM_ACTIVITY.IN_OFFICE] }
    },
    {
      key: 'to_time',
      label: 'To',
      type: 'time',
      width: 'sm',
      afterField: 'from_time',
      showWhen: { field: 'gem_team_activity', equals: [GEM_ACTIVITY.IN_OFFICE] }
    },

    // ---- OnSite only: a visit can span more than one day, so this is a
    // DATE range, not a time-of-day one ----
    {
      key: 'from_date',
      label: 'From',
      type: 'date',
      width: 'sm',
      showWhen: { field: 'gem_team_activity', equals: [GEM_ACTIVITY.ONSITE] }
    },
    {
      key: 'to_date',
      label: 'To',
      type: 'date',
      width: 'sm',
      afterField: 'from_date',
      // Inclusive (see afterField's own doc comment) — a one-day visit has
      // From == To, which is the common case, not an edge case.
      showWhen: { field: 'gem_team_activity', equals: [GEM_ACTIVITY.ONSITE] }
    },

    {
      key: 'next_action_required',
      label: 'Next Action Required',
      type: 'select',
      options: GEM_YES_NO,
      width: 'sm',
      showWhen: { field: 'gem_team_activity', equals: [GEM_ACTIVITY.IN_OFFICE, GEM_ACTIVITY.ONSITE] }
    },
    {
      // Chained on next_action_required — see comm_next_follow_up_date's
      // comment above for why.
      key: 'next_action_details',
      label: 'Next Action Details',
      type: 'textarea',
      maxLength: 1000,
      width: 'lg',
      showWhen: { field: 'next_action_required', equals: ['Yes'] }
    },

    // ---- In Office only ----
    {
      key: 'activity_participants',
      label: 'Activity Participants',
      type: 'select',
      options: GEM_PARTICIPANTS_OPTIONS,
      width: 'sm',
      showWhen: { field: 'gem_team_activity', equals: [GEM_ACTIVITY.IN_OFFICE] }
    },
    {
      key: 'meeting_activity_type',
      label: 'Meeting / Activity Type',
      type: 'select',
      options: GEM_MEETING_TYPE_OPTIONS,
      width: 'sm',
      showWhen: { field: 'gem_team_activity', equals: [GEM_ACTIVITY.IN_OFFICE] }
    },
    {
      key: 'inoffice_outcome_action_items',
      label: 'Outcome / Action Items',
      type: 'textarea',
      maxLength: 2000,
      width: 'lg',
      showWhen: { field: 'gem_team_activity', equals: [GEM_ACTIVITY.IN_OFFICE] }
    },

    // ---- OnSite only ----
    {
      key: 'visit_with',
      label: 'Visit With',
      type: 'select',
      options: ['Client', 'Vendor', 'Internal Team'],
      width: 'sm',
      showWhen: { field: 'gem_team_activity', equals: [GEM_ACTIVITY.ONSITE] }
    },
    {
      key: 'client_vendor_name',
      label: 'Client / Vendor Name',
      type: 'text',
      required: true,
      maxLength: 255,
      width: 'md',
      showWhen: { field: 'gem_team_activity', equals: [GEM_ACTIVITY.ONSITE] }
    },
    {
      key: 'onsite_outcome_feedback',
      label: 'Visit Outcome / Demo Feedback',
      type: 'textarea',
      maxLength: 2000,
      width: 'lg',
      showWhen: { field: 'gem_team_activity', equals: [GEM_ACTIVITY.ONSITE] }
    }
  ]
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
    { key: 'priority', label: 'Priority', type: 'select', required: true, options: PRIORITY_OPTIONS, width: 'sm' },
    { key: 'status', label: 'Status', type: 'select', required: true, options: RND_STATUS_OPTIONS, width: 'sm' },
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
  supportsTmsTaskLink: true,
  autoRowHint: 'Linked to a TMS task — synced automatically, not editable. Add your notes below.',
  headerFields: [],
  rowFields: [
    TASK_ID_FIELD,
    // The link to a real TMS task, set only by components/TmsTaskPicker.tsx
    // (never typed) — see its own doc comment on TemplateDefinition and
    // lib/aiTmsTaskLink.ts, which re-derives every tms_*-prefixed field
    // below from the live TmsTask on every save.
    { key: 'tms_task_id', label: 'Linked TMS Task', type: 'text', hidden: true },
    { key: 'task_description', label: 'Task Description', type: 'textarea', required: true, maxLength: 2000, width: 'xl' },
    // Appears only for "Other", and is required only then — see showWhen on
    // DailyReportFieldDef. Without it, choosing Other would record a task
    // whose category says nothing. Stays editable even on a linked row: a
    // reporting classification (client/internal/other) is independent of
    // which real TMS project the task happens to belong to — see
    // tms_project_name below, which carries that separately.
    { key: 'project', label: 'Project / Category', type: 'select', required: true, options: AI_PROJECT_CATEGORY_OPTIONS, width: 'md', editableWhenAuto: true },
    {
      key: 'project_other',
      label: 'Which project / category?',
      type: 'text',
      required: true,
      maxLength: 255,
      width: 'md',
      showWhen: { field: 'project', equals: ['Other'] },
      editableWhenAuto: true
    },
    { key: 'priority', label: 'Priority', type: 'select', required: true, options: PRIORITY_OPTIONS, width: 'sm' },
    // The 3-way bucket every other report in this module uses, kept
    // accurate for a linked row by lib/aiTmsTaskLink.ts's mapping — but
    // TMS has 7 states to this field's 3, so tms_status_label right next to
    // it is what actually says "Blocked" or "Ready for Review" rather than
    // forcing a lossy guess to stand in for the real word.
    { key: 'status', label: 'Status', type: 'select', required: true, options: AI_STATUS_OPTIONS, width: 'sm' },
    { key: 'tms_status_label', label: 'TMS Status', type: 'text', width: 'sm', showWhen: { field: 'tms_task_id', notEmpty: true } },
    { key: 'tms_project_name', label: 'TMS Project', type: 'text', width: 'md', showWhen: { field: 'tms_task_id', notEmpty: true } },
    { key: 'tms_progress_percent', label: 'TMS Progress', type: 'text', width: 'sm', showWhen: { field: 'tms_task_id', notEmpty: true } },
    { key: 'due_date', label: 'Due Date', type: 'date', required: true, width: 'sm' },
    { key: 'days_left', label: 'Days Left', type: 'computed', computed: 'days_left', width: 'sm', help: 'From today to the due date, so it keeps counting down after the report is filed. A completed task shows the date it was completed instead.' },
    { key: 'notes', label: 'Notes', type: 'textarea', maxLength: 1000, width: 'lg', editableWhenAuto: true }
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
  gem_sales: GEM_SALES_TEMPLATE,
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
  /**
   * A sub-category level a MANAGER added to a select that had none.
   *
   * Keyed by the PARENT field's key. resolveTemplate turns each entry into a
   * real dependent select inserted straight after its parent, so the rest of
   * the module — the form, the validator, the sheet columns — sees an
   * ordinary field and needs no special case.
   *
   * Separate from `linkedOptions`, which replaces the catalogue of a
   * dependent field the template already declares (HR's Specific Activity).
   * Using one key for both would make "edit the built-in child" and "invent
   * a child" indistinguishable, and only the second may be removed again.
   */
  subCategories?: Record<string, { label: string; catalogue: Record<string, string[]> }>;
  minEntries?: number;
  /** Replaces the measure rows of a 'matrix' template. */
  measures?: string[];
  /** Replaces the numeric columns of a 'matrix' template. */
  channels?: string[];
}

/** A built-in template with this department's admin overrides applied. */
/**
 * The field key a manager-added sub-category takes.
 *
 * Derived from the parent rather than chosen, so the stored entry data keeps
 * the same key across edits — renaming the LABEL must never orphan values
 * already filed under it.
 */
export function subCategoryKeyFor(parentKey: string): string {
  return `${parentKey}_sub`;
}

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

  /**
   * Insert each manager-defined sub-category field directly after its
   * parent. Placement matters: the form reads fields in order, and a
   * sub-category that rendered after Notes would not read as belonging to
   * the category above it.
   *
   * A parent that is not in this list passes through untouched, and a
   * template that already declares its own dependent child is left alone —
   * `subCategories` is only ever consulted for a parent with no native
   * child, which lib/dailyReportCategoryFields.ts enforces on write.
   */
  const withSubCategories = (fields: DailyReportFieldDef[]): DailyReportFieldDef[] => {
    if (!overrides.subCategories) return fields;
    const out: DailyReportFieldDef[] = [];
    for (const field of fields) {
      out.push(field);
      const sub = overrides.subCategories[field.key];
      if (!sub || !Object.keys(sub.catalogue ?? {}).length) continue;
      out.push({
        key: subCategoryKeyFor(field.key),
        label: sub.label || 'Sub-category',
        type: 'select',
        dependsOn: field.key,
        linkedOptions: sub.catalogue,
        options: Object.keys(sub.catalogue),
        width: field.width ?? 'md'
      });
    }
    return out;
  };

  return {
    ...base,
    headerFields: withSubCategories(base.headerFields.map(applyField)),
    rowFields: withSubCategories(base.rowFields.map(applyField)),
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

  // A hidden conditional field is neither validated nor required. This is
  // the server-side half of showWhen, and it has to match the renderer: if
  // the form hides a field the server still requires, the report simply
  // cannot be submitted and the message points at a box nobody can see.
  if (!isFieldVisible(field, raw)) return;

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

  if (field.type === 'date') {
    if (!isIsoDateLike(value)) {
      issues.push({ path, message: `${field.label} must be a valid date.` });
      return;
    }
    if (field.afterField) {
      const sibling = asTrimmedString(raw[field.afterField]);
      // Inclusive, unlike 'time' below: a one-day visit has From == To.
      if (sibling && isIsoDateLike(sibling) && value < sibling) {
        issues.push({ path, message: `${field.label} cannot be before the start date.` });
      }
    }
    return;
  }

  if (field.type === 'time') {
    if (!isClockTimeLike(value)) {
      issues.push({ path, message: `${field.label} must be a valid time.` });
      return;
    }
    if (field.afterField) {
      const sibling = asTrimmedString(raw[field.afterField]);
      if (sibling && isClockTimeLike(sibling) && value <= sibling) {
        issues.push({ path, message: `${field.label} must be later than the start time.` });
      }
    }
    return;
  }

  if (field.type === 'text' && field.format === 'url' && !isUrlLike(value)) {
    issues.push({ path, message: `${field.label} must be a valid web address, starting with http:// or https://.` });
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

/** 'HH:MM', 24-hour. Same shape lib/dailyReportTime.ts's isClockTime checks,
 *  duplicated rather than imported for the same reason as isIsoDateLike above. */
function isClockTimeLike(value: string): boolean {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
}

function isUrlLike(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
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
        // A field hidden by its own showWhen (or whose dependsOn parent is
        // unset) is never persisted, even if the raw row still carries a
        // stale value for it — e.g. a multi-level showWhen chain the client
        // only clears one level of (see setEntry's own clearing logic),
        // or simply an old cached payload. The server never trusts the
        // client to have cleared what it can check for itself.
        if (!isFieldVisible(field, row)) return;
        if (field.dependsOn && !asTrimmedString(row[field.dependsOn])) return;
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
  /** Days from TODAY to the due date. Absent once the task is Completed. */
  days_left?: number;
  /**
   * The due date has passed and the task was never marked Completed.
   * Derived here, in one place, so the form and the server can never
   * disagree about what counts as late.
   */
  overdue?: boolean;
  /**
   * The IST date the task was FIRST marked Completed. Absent for an open
   * task, and also for rows that were completed before this was stamped.
   */
  completed_on?: string;
}

/**
 * The read-only columns: a stable per-entry code, days-left, whether the task
 * is now overdue, and when it was completed.
 *
 * Computed at every read rather than stored, so editing a report's rows can't
 * leave a stale "4 days left" behind. The code is positional within one report
 * ("AI-2026-10-14-03") — unique and meaningful in context without needing a
 * global sequence.
 *
 * days-left is measured from TODAY, not from the reporting date. Measuring it
 * from the reporting date made it a number that could never change and an
 * overdue flag that could never fire: a task filed on the 16th and due on the
 * 18th read "2 days" for the rest of time, however long it actually stayed
 * open. The report is still a snapshot of what was reported that day —
 * report_date and due_date are both stored, so that question stays answerable
 * — but a column labelled "Days Left" is read as "from now", and answering it
 * from a frozen anchor is the kind of honest-looking wrong number nobody
 * thinks to check.
 *
 * today is passed in rather than read off the clock, so this stays pure and
 * the caller owns the timezone (IST, via istDate()).
 */
export function computeDerivedValues(
  template: TemplateDefinition,
  reportDate: string,
  entry: Record<string, unknown>,
  index: number,
  today: string
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
      // A finished task has no countdown; what matters is when it was
      // finished, so the same cell carries the completion date instead.
      // That is also what stops a row edited to Completed from being
      // indistinguishable from one that was already done when it was filed.
      if (asTrimmedString(entry.status) === 'Completed') {
        const stamp = asTrimmedString(entry.completed_on).slice(0, 10);
        if (isIsoDateLike(stamp)) derived.completed_on = stamp;
        derived.overdue = false;
        continue;
      }
      const due = asTrimmedString(entry.due_date);
      if (due && isIsoDateLike(due)) {
        // Falls back to the reporting date if the caller passed no today,
        // so a missing argument degrades to the old behaviour rather than
        // to NaN.
        const from = isIsoDateLike(today) ? today : reportDate;
        const a = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)));
        const b = Date.UTC(Number(due.slice(0, 4)), Number(due.slice(5, 7)) - 1, Number(due.slice(8, 10)));
        derived.days_left = Math.round((b - a) / 86_400_000);
        derived.overdue = derived.days_left < 0;
      }
    }
  }
  return derived;
}

/** An entry whose due date has passed and which was never marked Completed. */
export function isEntryOverdue(
  template: TemplateDefinition,
  reportDate: string,
  entry: Record<string, unknown>,
  index: number,
  today: string
): boolean {
  return computeDerivedValues(template, reportDate, entry, index, today).overdue === true;
}

/**
 * A row's identity for the purpose of carrying a completion stamp:
 * everything about it EXCEPT its status and the stamp itself.
 *
 * The entries table has no stable per-row id — replaceEntries hard-deletes
 * and recreates every row on every save, so the UUIDs change each time and
 * the Task ID is positional. Matching on content is therefore the only
 * identity available that survives the row moving, and it is what stops an
 * inserted or deleted row from shifting every stamp below it onto the wrong
 * task. Editing the task description does break the match, which is the
 * right answer: a rewritten task is a different task.
 */
function completionKeyOf(data: Record<string, unknown>): string {
  return JSON.stringify(
    Object.keys(data)
      .filter((key) => key !== 'status' && key !== 'completed_on')
      .sort()
      .map((key) => [key, data[key]])
  );
}

/**
 * Resolves completed_on across a whole generation of entries: the date a row
 * was FIRST marked Completed, carried forward unchanged on every later save.
 *
 * Without it, a task filed as In Progress on the 16th and edited to Completed
 * on the 18th is stored identically to one that was already done when it was
 * filed — the row just reads "Completed" with nothing to say when that became
 * true.
 *
 * Lives beside computeDerivedValues deliberately: that function is the READ
 * rule for this value and this is the WRITE rule, and a read rule that drifts
 * from its write rule is how a field starts lying. The stamp is server-side
 * only — validateReportPayload rebuilds every row from the template field
 * list, so an incoming payload can neither forge one nor wipe one out.
 *
 * Four cases, and the third is the one worth reading twice:
 *
 *  - not Completed    -> no stamp. Re-opening a finished task clears it, so
 *                        it can never describe a row that no longer claims to
 *                        be finished.
 *  - no prior row     -> reportDate. The row is being filed as already done,
 *                        so the day it reports on IS the completion date —
 *                        not today, which may be the next morning, since the
 *                        deadline is 11:00 on D+1 and a manager may back-fill
 *                        a missing day weeks later.
 *  - prior was        -> carry it. If the prior row was Completed but carries
 *    Completed           NO stamp (every row filed before this field existed),
 *                        the stamp stays ABSENT rather than becoming today.
 *                        computeDerivedValues shows nothing for those rows and
 *                        nothing is the honest answer; writing today would
 *                        assert a completion that did not happen today.
 *  - prior was open   -> today. This save is the transition, so today is the
 *                        date it actually happened.
 */
export function carryCompletions(
  incoming: Record<string, unknown>[],
  prior: Record<string, unknown>[],
  reportDate: string,
  today: string
): Record<string, unknown>[] {
  const byKey = new Map<string, Record<string, unknown>[]>();
  for (const row of prior) {
    const key = completionKeyOf(row);
    const bucket = byKey.get(key);
    if (bucket) bucket.push(row);
    else byKey.set(key, [row]);
  }

  const withoutStamp = (data: Record<string, unknown>) => {
    if (!('completed_on' in data)) return data;
    const { completed_on: _dropped, ...rest } = data;
    return rest;
  };

  return incoming.map((data, index) => {
    if (asTrimmedString(data.status) !== 'Completed') return withoutStamp(data);

    // Content match where it is unambiguous, position only as a fallback —
    // two genuinely identical rows are indistinguishable either way.
    const sameKey = byKey.get(completionKeyOf(data)) ?? [];
    const match = sameKey.length === 1 ? sameKey[0] : prior[index];

    if (!match) return { ...data, completed_on: reportDate };

    if (asTrimmedString(match.status) === 'Completed') {
      const carried = asTrimmedString(match.completed_on);
      return carried ? { ...data, completed_on: carried } : withoutStamp(data);
    }

    return { ...data, completed_on: today };
  });
}
