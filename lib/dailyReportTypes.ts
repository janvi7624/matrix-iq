// Record shapes the Daily Report API returns and its client components
// consume. Type-only and dependency-light on purpose (it pulls in nothing
// but the template/time type declarations), so a client component can import
// it without dragging Sequelize into the browser bundle.
//
// Declared here rather than appended to lib/types.ts because this module
// contributes ~15 interfaces and types.ts is already 2,000 lines; types.ts
// re-exports the handful that other modules touch, following the same
// arrangement it already uses for LeadOrigin and ProjectDepartment.

import type { DailyReportFieldDef, DailyReportLayout, DailyReportTemplateKey, DerivedEntryValues, TemplateDefinition, TemplateOverrides } from './dailyReportTemplates';
import type { WarningBannerTone } from './dailyReportSweepPlan';

export type { DailyReportTemplateKey, DailyReportLayout, DailyReportFieldDef, DerivedEntryValues, TemplateDefinition, TemplateOverrides };

/**
 * Whether the EMPLOYEE has filed.
 *
 * Submission is terminal: once a report is SUBMITTED or SUBMITTED_LATE its
 * content is locked, and changing it needs a department manager's permission
 * (see daily_report_edit_requests). Manager 'review' no longer exists —
 * conflating the two is how "submitted" quietly starts to mean "approved",
 * and the brief is explicit that manager approval is not a gate here.
 */
export type DailyReportSubmissionStatus = 'DRAFT' | 'SUBMITTED' | 'SUBMITTED_LATE';

/** Whether a MANAGER has looked at it. Informational, never a gate. */
export type DailyReportLeaveClaimStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export type DailyReportWarningStatus = 'ACTIVE' | 'WAIVED';

export interface DailyReportEntryRecord {
  id: string;
  position: number;
  /** Template row-field values, keyed by field key. */
  data: Record<string, unknown>;
  /**
   * Server-computed read-only columns — Task ID, Days Left, whether the row
   * is overdue, and when it was completed. Carries the full
   * DerivedEntryValues rather than restating a subset of it: the narrowed
   * version silently hid overdue and completed_on from every consumer even
   * though toRecord was already sending them.
   */
  derived: DerivedEntryValues;
  overdue: boolean;
}

export interface DailyReportRecord {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_username: string;
  department_id: string;
  department_name: string;
  report_date: string;
  template_key: DailyReportTemplateKey;
  submission_status: DailyReportSubmissionStatus;
  /** Header field values for this template. */
  payload: Record<string, unknown>;
  /** Computed header-level columns (currently just Task ID, for AV/Sales — the
      'narrative'/'matrix' templates, which have no rows to attach it to).
      Empty for a 'rows' template, whose Task ID lives on each entry instead. */
  header_derived: DerivedEntryValues;
  /** measure -> channel -> count, for the Sales grid. Empty otherwise. */
  matrix: Record<string, Record<string, number>>;
  entries: DailyReportEntryRecord[];
  /** ISO. The ORIGINAL submission instant — never rewritten by a later edit. */
  submitted_at: string;
  is_late: boolean;
  /** ISO. The deadline this report was actually judged against. */
  deadline_at: string;
  /** Empty unless a manager filed this on the employee's behalf. */
  filed_by_name: string;
  created_at: string;
  updated_at: string;
}

export interface DailyReportRevisionRecord {
  id: string;
  at: string;
  actor_name: string;
  action: string;
  submission_status: string;
  note: string;
}

/**
 * Permission to edit a report that has already been filed.
 *
 * 'USED' and 'EXPIRED' are both spent states, kept apart so the history says
 * whether an approval was actually redeemed or simply ran out.
 */
export type DailyReportEditRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'USED' | 'EXPIRED';

export interface DailyReportEditRequestRecord {
  id: string;
  report_id: string;
  employee_id: string;
  employee_name: string;
  department_name: string;
  report_date: string;
  reason: string;
  status: DailyReportEditRequestStatus;
  decided_by_name: string;
  decided_at: string;
  decision_reason: string;
  /** ISO. When an approval stops being redeemable. '' unless APPROVED. */
  grant_expires_at: string;
  used_at: string;
  created_at: string;
}

export interface DailyReportLeaveClaimRecord {
  id: string;
  employee_id: string;
  employee_name: string;
  department_name: string;
  report_date: string;
  reason: string;
  attachments: { name: string; path: string; size?: number }[];
  status: DailyReportLeaveClaimStatus;
  reviewed_by_name: string;
  reviewed_at: string;
  decision_reason: string;
  created_at: string;
}

export interface DailyReportWarningRecord {
  id: string;
  employee_id: string;
  employee_name: string;
  department_name: string;
  report_date: string;
  month_key: string;
  status: DailyReportWarningStatus;
  source: string;
  waived_by_name: string;
  waived_at: string;
  waiver_reason: string;
  created_at: string;
}

/** One employee's month, as the HR Warnings tab groups it. */
export interface DailyReportWarningGroup {
  employee_id: string;
  employee_name: string;
  department_name: string;
  month_key: string;
  active_warnings: number;
  waived_warnings: number;
  /** Reporting dates of the ACTIVE warnings only. */
  missed_dates: string[];
  /** 'none' | 'single' | 'consecutive' | 'scattered' — see missedDatePattern. */
  pattern: string;
  hr_escalated: boolean;
  hr_escalated_at: string;
  warnings: DailyReportWarningRecord[];
}

export interface DailyReportWarningSummary {
  month_key: string;
  active_count: number;
  waived_count: number;
  threshold: number;
  escalated: boolean;
  banner: { tone: WarningBannerTone; headline: string; detail: string };
  /** Every warning this month, active and waived, newest first. */
  warnings: DailyReportWarningRecord[];
}

/**
 * The minimum a shortcut needs to know: should this person be asked to file
 * today, and have they. Deliberately NOT MyDailyReportResponse — that loads
 * the template, the history strip, the warning summary and the revision
 * list, none of which a button renders.
 */
export interface MyDailyReportStatus {
  /** False for an excused account, an unconfigured department, or a non-working day. */
  required: boolean;
  /** Why it is not required, for the caller's own wording. '' when it is. */
  not_required_reason: 'exempt' | 'not_configured' | 'non_working_day' | 'no_department' | '';
  report_date: string;
  /** 'MISSING' when nothing exists yet; DRAFT does not count as filed. */
  submission_status: DailyReportSubmissionStatus | 'MISSING';
  deadline_at: string;
  past_deadline: boolean;
}

/** Everything the employee's own page needs for one reporting date. */
export interface MyDailyReportResponse {
  report_date: string;
  /** False for Sundays and holidays, when no report is expected. */
  is_working_day: boolean;
  deadline_at: string;
  deadline_date: string;
  /** True once the deadline has passed and nothing is submitted yet. */
  past_deadline: boolean;
  /**
   * The previous working day. Always present — history can be walked back
   * indefinitely.
   *
   * Resolved on the SERVER rather than by the client stepping a day at a
   * time, because "which day is the previous working one" depends on
   * working_days, holidays and observe_holidays — all admin-configurable
   * (see Daily Report Configuration). A client that guessed would silently
   * disagree with the deadline and warning engine the moment someone turned
   * Saturday off.
   */
  prev_working_day: string;
  /**
   * The next working day, or '' when that day has not happened yet. This is
   * what stops the forward arrow walking into the future.
   */
  next_working_day: string;
  /** Today in IST, so the client never has to decide what "today" means. */
  today: string;
  employee: { id: string; name: string; username: string; department_name: string };
  /** 'not_configured' means this department has no approved format yet. */
  template: TemplateDefinition;
  template_configured: boolean;
  /**
   * True when this person is on the excused list. Distinct from
   * template_configured being false: one means "your department has no
   * format", the other means "you personally are not required to file", and
   * the page says which rather than showing one message for both.
   */
  exempt: boolean;
  /** null when nothing has been started for this date. */
  report: DailyReportRecord | null;
  /**
   * The Sales/GEM-Sales auto-fetched measures for `report_date`, read fresh
   * on every load — independent of `report`, so the very first visit to an
   * unstarted day still shows real numbers instead of blanks. null for any
   * template with no auto measures, or once the report is submitted (its
   * own `report.matrix` is the frozen record at that point, not a moving
   * preview). When `report` already exists, this is the same data already
   * merged into `report.matrix` — exposed separately only so a client with
   * no report yet still has it to render from.
   */
  auto_preview: Record<string, Record<string, number>> | null;
  /**
   * GEM Sales' auto-generated Proposal Creation rows, merged with whatever
   * else is already in the draft — the rows-layout counterpart to
   * auto_preview above, for the same "first visit, no report yet" reason.
   * null for any template with no autoEntryActivity, or once submitted.
   */
  gem_entries_preview: Record<string, unknown>[] | null;
  revisions: DailyReportRevisionRecord[];
  /** The live claim for this date, if any. */
  leave_claim: DailyReportLeaveClaimRecord | null;
  /**
   * The live request to edit THIS filed report, if there is one. Carried on
   * the same response as the report so the page can say 'permission pending'
   * or 'approved until …' without a second fetch — exactly as leave_claim
   * above already does.
   */
  edit_request: DailyReportEditRequestRecord | null;
  warnings: DailyReportWarningSummary;
  /** Recent reporting dates with their status, for the history strip. */
  history: DailyReportHistoryItem[];
}

export interface DailyReportHistoryItem {
  report_date: string;
  /** 'PENDING' is today, not filed, before MISSING_VISIBLE_AFTER — see the
   *  same field on TeamDailyReportRow. */
  submission_status: DailyReportSubmissionStatus | 'MISSING' | 'PENDING';
  submitted_at: string;
  is_late: boolean;
  leave_status: DailyReportLeaveClaimStatus | '';
  warning_status: DailyReportWarningStatus | '';
  report_id: string;
}

/** One row of the manager dashboard. */
export interface TeamDailyReportRow {
  employee_id: string;
  employee_name: string;
  employee_username: string;
  department_id: string;
  department_name: string;
  report_date: string;
  template_key: DailyReportTemplateKey;
  template_configured: boolean;
  /** 'MISSING' when nothing was filed — a DRAFT also reads as MISSING here,
   *  because draft contents stay private and a draft does not satisfy the
   *  filing requirement.
   *
   *  'PENDING' is the same absence of a report, but for TODAY before
   *  MISSING_VISIBLE_AFTER (lib/dailyReportTime.ts) — the day is still open,
   *  so nothing is late yet. It is a separate value rather than a flavour of
   *  MISSING so the missing KPI and the Missing filter keep meaning exactly
   *  what they say. */
  submission_status: DailyReportSubmissionStatus | 'MISSING' | 'PENDING';
  submitted_at: string;
  is_late: boolean;
  leave_status: DailyReportLeaveClaimStatus | '';
  warning_status: DailyReportWarningStatus | '';
  filed_by_name: string;
  /** null unless a SUBMITTED report exists — never a draft. */
  report_id: string | null;
  entry_count: number;
}

export interface TeamDailyReportResponse {
  report_date: string;
  is_working_day: boolean;
  deadline_at: string;
  rows: TeamDailyReportRow[];
  kpis: {
    expected: number;
    submitted: number;
    submitted_late: number;
    missing: number;
    /** Not filed, but today is still open — see MISSING_VISIBLE_AFTER. Always
     *  0 for a past date, where everything unfiled is simply missing. */
    pending: number;
    pending_leave: number;
    approved_leave: number;
    not_configured: number;
  };
  /** Departments this viewer may filter by — their scope, not every department. */
  departments: { id: string; name: string }[];
  can_file_for_others: boolean;
}

// "How did my team do this month/quarter/year" — one row per employee,
// summed across every working day in the range, instead of
// TeamDailyReportRow's one-row-per-employee-for-one-day. "Who is missing
// right now" (the single-date view above) and "how did we do over time"
// (this one) are different questions with different shapes; this is not a
// list of individual reports; buildTeamDailyReportsRange is a reporting
// decision (see its doc comment) and `report_ids` under HISTORY_WORKING_DAYS
// scale is what a UI would drill into for the individual documents.
export interface TeamDailyReportRangeRow {
  employee_id: string;
  employee_name: string;
  employee_username: string;
  department_id: string;
  department_name: string;
  expected: number;
  submitted: number;
  submitted_late: number;
  missing: number;
  /** PENDING or APPROVED leave claims excluded from `missing` — not only
   *  approved ones; see loadLeaveCoveredKeys. */
  leave_covered: number;
  /** Rounded 0-100; 100 when nothing was expected (nothing to fall short of). */
  compliance_percent: number;
}

export interface TeamDailyReportRangeResponse {
  from: string;
  to: string;
  label: string;
  rows: TeamDailyReportRangeRow[];
  totals: {
    expected: number;
    submitted: number;
    submitted_late: number;
    missing: number;
    leave_covered: number;
  };
  departments: { id: string; name: string }[];
}

/**
 * One employee/date square in the team matrix.
 *
 * A deliberately flatter shape than TeamDailyReportRow: the matrix renders
 * hundreds of these, and every field here is one a cell actually paints.
 * Anything needing more detail opens the day itself.
 */
export interface TeamMatrixCell {
  /** 'MISSING' covers "nothing filed" and "draft" — see TeamDailyReportRow. */
  status: DailyReportSubmissionStatus | 'MISSING';
  is_late: boolean;
  leave_status: DailyReportLeaveClaimStatus | '';
  warning_status: DailyReportWarningStatus | '';
  report_id: string | null;
  entry_count: number;
  /** False when the employee did not owe a report that day (leave rota, exemption). */
  owed: boolean;
}

export interface TeamMatrixEmployee {
  employee_id: string;
  employee_name: string;
  employee_username: string;
  department_id: string;
  department_name: string;
  template_key: DailyReportTemplateKey;
  /** Keyed by ISO date. Dates the employee did not owe are present with owed:false. */
  cells: Record<string, TeamMatrixCell>;
  totals: {
    owed: number;
    submitted: number;
    submitted_late: number;
    missing: number;
    leave: number;
    entries: number;
  };
}

/** One day's tasks for the expanded employee, in template-field order. */
export interface TeamMatrixDayDetail {
  report_date: string;
  report_id: string | null;
  status: DailyReportSubmissionStatus | 'MISSING';
  is_late: boolean;
  submitted_at: string;
  leave_status: DailyReportLeaveClaimStatus | '';
  /** Row-based templates. Each entry is field key -> display string. */
  entries: Record<string, string>[];
  /** Narrative templates put their whole answer here instead of entries. */
  narrative: Record<string, string>;
}

export interface TeamMatrixExpansion {
  employee_id: string;
  employee_name: string;
  template_key: DailyReportTemplateKey;
  /** The template's row columns, in order — what the sheet's headers are. */
  columns: { key: string; label: string }[];
  days: TeamMatrixDayDetail[];
}

export interface TeamMatrixResponse {
  from: string;
  to: string;
  /** Working days in the range, oldest first — the sheet's column headers. */
  dates: string[];
  employees: TeamMatrixEmployee[];
  departments: { id: string; name: string }[];
  totals: {
    employees: number;
    owed: number;
    submitted: number;
    submitted_late: number;
    missing: number;
    leave: number;
  };
  /** Present only when ?expand= asked for one employee's tasks. */
  expansion: TeamMatrixExpansion | null;
}

export interface ExemptCandidate {
  id: string;
  name: string;
  username: string;
  department_name: string;
  role: string;
}

export interface DailyReportConfigRecord {
  id: string;
  timezone: string;
  working_days: number[];
  holidays: string[];
  observe_holidays: boolean;
  /** Recurring days off, e.g. [{ nth: 3, weekday: 6 }] = 3rd Saturday. */
  off_nth_weekdays: { nth: number; weekday: number }[];
  deadline_time: string;
  evening_reminder_time: string;
  final_reminder_time: string;
  /**
   * 'HH:MM' IST on the next working day after the reporting date — when an
   * unsubmitted Sales/GEM-Sales report (any auto-measures template) is
   * auto-submitted by the system. See lib/salesDailyAutoFetch.ts.
   */
  sales_auto_submit_time: string;
  warning_threshold: number;
  reconcile_window_days: number;
  scheduler_enabled: boolean;
  dry_run: boolean;
  leave_rejection_policy: 'reinstate' | 'waive';
  /**
   * Employees excused from filing. Excluded from the expected set entirely,
   * so they get no form, no reminders and no warnings, and they do not sit
   * in anyone's compliance denominator making a team look non-compliant.
   */
  exempt_employee_ids: string[];
  updated_at: string;
  updated_by_name: string;
}

export interface DailyReportTemplateAssignment {
  id: string;
  department_id: string;
  department_name: string;
  template_key: DailyReportTemplateKey;
  status: 'active' | 'not_configured';
  overrides: TemplateOverrides;
  extra_manager_ids: string[];
  notes: string;
  /** Active employees in this department — i.e. how many people this affects. */
  employee_count: number;
  manager_names: string[];
  updated_at: string;
  updated_by_name: string;
}

export interface DailyReportSchedulerRunRecord {
  id: string;
  started_at: string;
  finished_at: string;
  status: string;
  dry_run: boolean;
  trigger: string;
  stats: Record<string, unknown>;
  error: string;
}

/** The admin page's view of what the scheduler has been doing. */
export interface DailyReportConfigResponse {
  config: DailyReportConfigRecord;
  templates: DailyReportTemplateAssignment[];
  /** Catalogue of built-in formats an admin can assign. */
  available_templates: { key: DailyReportTemplateKey; label: string; description: string; layout: DailyReportLayout }[];
  runs: DailyReportSchedulerRunRecord[];
  /** Recent notification attempts, newest first — the delivery log. */
  recent_events: {
    id: string;
    employee_name: string;
    report_date: string;
    event_key: string;
    status: string;
    processed_at: string;
    due_at: string;
    error: string;
  }[];
  /** Resolved HR recipients for escalations, so a misconfiguration is visible. */
  hr_recipients: string[];
  /** Everyone who could be excused, for the picker. */
  employees: ExemptCandidate[];
  /** The excused list resolved to names, so the page never shows bare ids. */
  exempt_employees: ExemptCandidate[];
  cron_hint: { path: string; secret_env: string; configured: boolean };
}

export interface DailyReportAnalyticsRow {
  key: string;
  label: string;
  expected: number;
  submitted_on_time: number;
  submitted_late: number;
  missing: number;
  compliance_percent: number;
  active_warnings: number;
  waived_warnings: number;
  pending_leave: number;
  approved_leave: number;
  manager_filed: number;
}

export interface DailyReportAnalyticsResponse {
  month_key: string;
  working_days: string[];
  totals: DailyReportAnalyticsRow;
  by_department: DailyReportAnalyticsRow[];
  by_employee: DailyReportAnalyticsRow[];
}
