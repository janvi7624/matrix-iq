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
 * Whether the EMPLOYEE has filed. Deliberately separate from review status:
 * conflating the two is how "submitted" quietly starts to mean "approved",
 * and the brief is explicit that manager approval is not a gate here.
 */
export type DailyReportSubmissionStatus = 'DRAFT' | 'SUBMITTED' | 'SUBMITTED_LATE';

/** Whether a MANAGER has looked at it. Informational, never a gate. */
export type DailyReportReviewStatus = 'NOT_REVIEWED' | 'REVIEWED' | 'CHANGES_REQUESTED';

export type DailyReportLeaveClaimStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export type DailyReportWarningStatus = 'ACTIVE' | 'WAIVED';

export interface DailyReportEntryRecord {
  id: string;
  position: number;
  /** Template row-field values, keyed by field key. */
  data: Record<string, unknown>;
  /** Server-computed read-only columns (Task ID, Days Left). */
  derived: { task_code?: string; days_left?: number };
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
  review_status: DailyReportReviewStatus;
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
  reviewed_by_name: string;
  reviewed_at: string;
  review_note: string;
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
  revisions: DailyReportRevisionRecord[];
  /** The live claim for this date, if any. */
  leave_claim: DailyReportLeaveClaimRecord | null;
  warnings: DailyReportWarningSummary;
  /** Recent reporting dates with their status, for the history strip. */
  history: DailyReportHistoryItem[];
}

export interface DailyReportHistoryItem {
  report_date: string;
  submission_status: DailyReportSubmissionStatus | 'MISSING';
  review_status: DailyReportReviewStatus | '';
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
   *  filing requirement. */
  submission_status: DailyReportSubmissionStatus | 'MISSING';
  submitted_at: string;
  is_late: boolean;
  review_status: DailyReportReviewStatus | '';
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
    pending_leave: number;
    approved_leave: number;
    not_configured: number;
  };
  /** Departments this viewer may filter by — their scope, not every department. */
  departments: { id: string; name: string }[];
  can_file_for_others: boolean;
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
