'use strict';

/**
 * Daily Report Management — every table the module needs, in one migration.
 *
 * Kept as a single migration because the ten tables are one feature with one
 * set of foreign keys between them; splitting it would only create an order
 * in which a partial deploy leaves the module half-built.
 *
 * Nothing here duplicates an existing concept: employees are `users`,
 * departments are `departments`, in-app notifications are `notifications`
 * (lib/notificationStore.ts), email is AWS SES (lib/email/emailService.ts),
 * and the action trail is the existing `audit_logs` table (entity_type is a
 * plain string there, so 'daily_report' needs no schema change). What is new
 * is only what had nowhere to live: the reports themselves, the leave
 * claims, the warning ledger, and the scheduler's idempotency records.
 *
 * Index/constraint notes, since several of these are load-bearing:
 *
 *  - Every unique index is PARTIAL (`WHERE deleted_at IS NULL`) on the
 *    soft-deleted tables, matching this repo's existing convention (see
 *    20261009150000-create-materials.js) — a soft-deleted row must never
 *    block the same natural key from being used again.
 *  - daily_reports is unique on (employee_id, department_id, report_date),
 *    which is the brief's "one report per employee, department and date"
 *    enforced in the database rather than by a read-then-write race.
 *  - daily_report_warnings is unique on (employee_id, report_date): the
 *    scheduler's warning step is therefore idempotent even if two sweeps
 *    overlap, independently of the event ledger.
 *  - daily_report_escalations is unique on (employee_id, month_key), which
 *    is what caps HR escalation at one per employee per calendar month.
 *  - daily_report_notification_events is unique on
 *    (employee_id, report_date, event_key) — the ledger a retry collides
 *    with instead of sending a second reminder.
 *  - daily_report_leave_claims uses a partial unique index that EXCLUDES
 *    rejected claims, so one date can have only one live claim but a
 *    rejected claim doesn't permanently bar re-raising it.
 *
 * The final DO block re-applies this database's `vps_all` row-level-security
 * policy to the new tables. That is not optional here: the app connects as
 * the low-privilege `matrixiq_vps` role, and a new table that ends up with
 * RLS enabled and no policy denies every read and write silently — see
 * 20260928120000-vps-rls-policy-for-missing-tables.js for the incident this
 * traces back to. Inert on a database with no such role (e.g. a local one).
 */

const UUID_PK = (Sequelize) => ({
  type: Sequelize.UUID,
  defaultValue: Sequelize.literal('gen_random_uuid()'),
  primaryKey: true,
  allowNull: false
});

const TIMESTAMPS = (Sequelize, { paranoid = true } = {}) => ({
  created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
  updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
  ...(paranoid ? { deleted_at: { type: Sequelize.DATE, allowNull: true } } : {})
});

const userRef = (Sequelize, allowNull = true) => ({
  type: Sequelize.UUID,
  allowNull,
  references: { model: 'users', key: 'id' },
  onUpdate: 'CASCADE',
  onDelete: 'SET NULL'
});

module.exports = {
  async up(queryInterface, Sequelize) {
    // ---------------------------------------------------------------- config
    // Singleton policy row. A table rather than more columns on app_config
    // because this is a self-contained module's policy (working days,
    // deadline clock, reminder clock, warning threshold, scheduler arming)
    // and because app_config is read on nearly every quotation/PDF code
    // path — there is no reason to widen that hot row for this.
    await queryInterface.createTable('daily_report_config', {
      id: UUID_PK(Sequelize),
      // Every reporting date, deadline and scheduled job is interpreted in
      // this zone. Stored (not hardcoded) so an overseas rollout is a config
      // change, but defaulted to the zone the business actually runs in.
      timezone: { type: Sequelize.STRING(64), allowNull: false, defaultValue: 'Asia/Kolkata' },
      // Day-of-week numbers (0 = Sunday). Default Mon–Sat per the stated
      // working-day policy; Sunday is excluded, so no report is ever
      // expected for it.
      working_days: { type: Sequelize.JSONB, allowNull: false, defaultValue: [1, 2, 3, 4, 5, 6] },
      // 'YYYY-MM-DD' public holidays, only honoured when
      // observe_holidays is true. False by default because the agreed
      // interim policy is "public holidays are treated as working days
      // until a configurable holiday calendar is implemented" — the list
      // is therefore visible and editable but inert, rather than being
      // quietly applied before anyone has curated it.
      holidays: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      observe_holidays: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      // 'HH:MM' IST. A report is due at this time on the next WORKING day
      // after its reporting date, which is what makes Saturday's report due
      // Monday without a special case anywhere.
      deadline_time: { type: Sequelize.STRING(5), allowNull: false, defaultValue: '11:00' },
      evening_reminder_time: { type: Sequelize.STRING(5), allowNull: false, defaultValue: '21:00' },
      final_reminder_time: { type: Sequelize.STRING(5), allowNull: false, defaultValue: '10:00' },
      // Active warnings in one calendar month that trigger the single HR
      // escalation for that employee that month.
      warning_threshold: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 3 },
      // How many days back a sweep reconciles. Bounds the catch-up after
      // downtime so restoring a backup cannot retroactively warn people for
      // months of dates nobody was ever reminded about.
      reconcile_window_days: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 7 },
      // Master switch. Ships OFF: the tables, pages and APIs all work, but
      // nothing is emailed to staff until an admin deliberately arms it.
      scheduler_enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      // Ships ON, and must be turned off separately from arming the
      // scheduler — the brief's "use a dry-run mode for scheduled reminders
      // and warnings before enabling live notifications in production". In
      // dry-run the sweep computes and LOGS exactly what it would do, writes
      // no warnings and sends nothing.
      dry_run: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      // What happens to the reporting obligation when HR rejects a leave
      // claim. 'reinstate' (default) puts the date back in scope, so the
      // normal sweep records a warning for it if it is still unfiled and
      // still inside the reconcile window — no silent backdating beyond
      // that. 'waive' records the rejection but leaves the date excused.
      // Configurable rather than hardcoded because it is a people policy.
      leave_rejection_policy: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'reinstate' },
      updated_by: userRef(Sequelize),
      ...TIMESTAMPS(Sequelize, { paranoid: false })
    });

    // ------------------------------------------------------------- templates
    // Which report format each department files, plus the narrow set of
    // admin-editable overrides (dropdown options, the HR category→activity
    // catalogue, the minimum row count). The FIELD SETS themselves live in
    // code (lib/dailyReportTemplates.ts) because field keys are what the
    // manager view, the validator and analytics all read.
    await queryInterface.createTable('daily_report_templates', {
      id: UUID_PK(Sequelize),
      department_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'departments', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      // 'hr' | 'sales' | 'av' | 'rnd' | 'ai' | 'marketing' | 'robotics' |
      // 'not_configured'. A plain string, not a PG enum: a ninth format must
      // be addable without a migration, and enum values can never be
      // dropped once added (same stance as materials.category).
      template_key: { type: Sequelize.STRING(32), allowNull: false, defaultValue: 'not_configured' },
      // 'active' once a format is approved for this department;
      // 'not_configured' means no report is expected — Accounts ships this
      // way, so its staff are excluded from reminders and warnings entirely
      // rather than being nagged for a format nobody has designed.
      status: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'not_configured' },
      overrides: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      // Whose inbox a submitted report lands in, on top of the department's
      // own managers from Department Master. Empty is the normal case.
      extra_manager_ids: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      notes: { type: Sequelize.TEXT, allowNull: true },
      updated_by: userRef(Sequelize),
      ...TIMESTAMPS(Sequelize)
    });
    await queryInterface.addIndex('daily_report_templates', ['department_id'], {
      unique: true,
      name: 'daily_report_templates_department_unique',
      where: { deleted_at: null }
    });

    // --------------------------------------------------------------- reports
    await queryInterface.createTable('daily_reports', {
      id: UUID_PK(Sequelize),
      // The report's OWNER — always the employee the day belongs to, even
      // when a manager filed it for them (that is filed_by_user_id below).
      employee_id: { ...userRef(Sequelize, false), onDelete: 'CASCADE' },
      department_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'departments', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
      },
      // DATEONLY, never a timestamp: the reporting date is an IST calendar
      // day, and storing it as an instant is how a report silently moves to
      // the previous day for a server in UTC.
      report_date: { type: Sequelize.DATEONLY, allowNull: false },
      // Captured at creation so a later template reassignment can't
      // retroactively invalidate or re-interpret a report already filed.
      template_key: { type: Sequelize.STRING(32), allowNull: false },
      // 'DRAFT' | 'SUBMITTED' | 'SUBMITTED_LATE'. Separate from
      // review_status by design: whether the employee filed is a different
      // question from whether a manager has looked at it, and conflating
      // them is how "submitted" starts meaning "approved".
      submission_status: { type: Sequelize.STRING(24), allowNull: false, defaultValue: 'DRAFT' },
      // 'NOT_REVIEWED' | 'REVIEWED' | 'CHANGES_REQUESTED'. Manager review is
      // informational — there is deliberately no approval gate, since the
      // brief says not to introduce one unless explicitly configured.
      review_status: { type: Sequelize.STRING(24), allowNull: false, defaultValue: 'NOT_REVIEWED' },
      // Header-level field values for this template (AV's narrative, the
      // sales grid's notes). JSONB because the shape is the template's, and
      // the template is data.
      payload: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      // measure -> channel -> count, for the Sales/GEM Sales grid. Kept
      // separate from `payload` so the numeric grid can be aggregated in SQL
      // without having to know which header fields exist.
      matrix: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      // Set ONCE, the first time the report is submitted, and never
      // rewritten — the brief's "editing a submitted report must never
      // overwrite its original submission timestamp". Every later edit
      // records itself in daily_report_revisions instead.
      submitted_at: { type: Sequelize.DATE, allowNull: true },
      // Frozen alongside submitted_at from the same comparison against the
      // computed deadline, so the on-time/late verdict can't drift if the
      // deadline policy is changed afterwards.
      is_late: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      // The deadline this report was actually judged against, stored for the
      // same reason: an audit must be able to show what the rule WAS.
      deadline_at: { type: Sequelize.DATE, allowNull: true },
      reviewed_by: userRef(Sequelize),
      reviewed_at: { type: Sequelize.DATE, allowNull: true },
      review_note: { type: Sequelize.TEXT, allowNull: true },
      // Non-null only for a manager-filed report. The employee stays the
      // owner; this records who actually did the typing, which is what makes
      // "File for Them" auditable rather than indistinguishable.
      filed_by_user_id: userRef(Sequelize),
      created_by: userRef(Sequelize),
      updated_by: userRef(Sequelize),
      ...TIMESTAMPS(Sequelize)
    });
    await queryInterface.addIndex('daily_reports', ['employee_id', 'department_id', 'report_date'], {
      unique: true,
      name: 'daily_reports_employee_department_date_unique',
      where: { deleted_at: null }
    });
    // The manager dashboard's main query: one date, every employee.
    await queryInterface.addIndex('daily_reports', ['report_date', 'department_id'], { name: 'daily_reports_date_department_idx' });
    // The employee's own history, newest first.
    await queryInterface.addIndex('daily_reports', ['employee_id', 'report_date'], { name: 'daily_reports_employee_date_idx' });
    // Analytics counts by status over a month.
    await queryInterface.addIndex('daily_reports', ['submission_status'], { name: 'daily_reports_submission_status_idx' });

    // --------------------------------------------------------------- entries
    // Row-based templates (HR, R&D, AI, Marketing, Robotics) store one row
    // per activity here rather than as a JSON array inside the report, so a
    // manager view can count and filter entries in SQL and a single row can
    // be referenced by position in an audit trail.
    await queryInterface.createTable('daily_report_entries', {
      id: UUID_PK(Sequelize),
      report_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'daily_reports', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      // 0-based display order, which is also what the reorder action
      // rewrites and what the generated Task ID is numbered from.
      position: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      // The template's row fields, keyed by field key. Validated against the
      // resolved template on the server before it ever gets here.
      data: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      ...TIMESTAMPS(Sequelize)
    });
    await queryInterface.addIndex('daily_report_entries', ['report_id', 'position'], { name: 'daily_report_entries_report_position_idx' });

    // ------------------------------------------------------------- revisions
    // Append-only modification history for one report. The shared audit_logs
    // table records WHO changed WHAT when across the app; this keeps the
    // actual before/after content, which audit_logs has no column for and
    // which is what "preserve an audit history of all modifications" needs
    // to be able to answer.
    await queryInterface.createTable('daily_report_revisions', {
      id: UUID_PK(Sequelize),
      report_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'daily_reports', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      actor_id: userRef(Sequelize),
      // 'created' | 'draft_saved' | 'submitted' | 'edited' | 'reviewed' |
      // 'filed_for_employee'
      action: { type: Sequelize.STRING(32), allowNull: false },
      submission_status: { type: Sequelize.STRING(24), allowNull: true },
      // Full content snapshot as of this revision: { payload, matrix, entries }.
      snapshot: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      note: { type: Sequelize.TEXT, allowNull: true },
      ...TIMESTAMPS(Sequelize, { paranoid: false })
    });
    await queryInterface.addIndex('daily_report_revisions', ['report_id', 'at'], { name: 'daily_report_revisions_report_at_idx' });

    // ---------------------------------------------------------- leave claims
    await queryInterface.createTable('daily_report_leave_claims', {
      id: UUID_PK(Sequelize),
      employee_id: { ...userRef(Sequelize, false), onDelete: 'CASCADE' },
      // Denormalised from the employee at claim time so an HR queue can be
      // filtered and grouped by department without a join, and so a later
      // transfer doesn't rewrite history.
      department_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'departments', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      report_date: { type: Sequelize.DATEONLY, allowNull: false },
      reason: { type: Sequelize.TEXT, allowNull: false },
      // [{ name, path, size }] from the existing upload pipeline
      // (lib/fileStorage.ts / app/api/uploads) — not a new storage system.
      attachments: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      // 'PENDING' | 'APPROVED' | 'REJECTED'
      status: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'PENDING' },
      reviewed_by: userRef(Sequelize),
      reviewed_at: { type: Sequelize.DATE, allowNull: true },
      // Mandatory on both approve and reject — every decision records the
      // reviewer, the timestamp and the reason.
      decision_reason: { type: Sequelize.TEXT, allowNull: true },
      ...TIMESTAMPS(Sequelize)
    });
    // One LIVE claim per employee per date. Rejected claims are excluded so a
    // rejection doesn't permanently bar re-raising the date with better
    // evidence, while a pending or approved claim blocks a duplicate.
    await queryInterface.addIndex('daily_report_leave_claims', ['employee_id', 'report_date'], {
      unique: true,
      name: 'daily_report_leave_claims_live_unique',
      where: { deleted_at: null, status: ['PENDING', 'APPROVED'] }
    });
    await queryInterface.addIndex('daily_report_leave_claims', ['status', 'report_date'], { name: 'daily_report_leave_claims_status_date_idx' });

    // -------------------------------------------------------------- warnings
    await queryInterface.createTable('daily_report_warnings', {
      id: UUID_PK(Sequelize),
      employee_id: { ...userRef(Sequelize, false), onDelete: 'CASCADE' },
      department_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'departments', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      report_date: { type: Sequelize.DATEONLY, allowNull: false },
      // 'YYYY-MM' of report_date, stored rather than derived so the monthly
      // active-count query is a plain indexed equality instead of a
      // to_char() over the whole table.
      month_key: { type: Sequelize.STRING(7), allowNull: false },
      // 'ACTIVE' | 'WAIVED'. Never deleted — a waived warning stays visible
      // in history and is only excluded from the active count, which is both
      // the brief's requirement and what makes a waiver auditable.
      status: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'ACTIVE' },
      // How this warning came about: 'scheduler' normally, 'leave_rejected'
      // when a rejected claim reinstated the obligation.
      source: { type: Sequelize.STRING(24), allowNull: false, defaultValue: 'scheduler' },
      waived_by: userRef(Sequelize),
      waived_at: { type: Sequelize.DATE, allowNull: true },
      waiver_reason: { type: Sequelize.TEXT, allowNull: true },
      ...TIMESTAMPS(Sequelize)
    });
    await queryInterface.addIndex('daily_report_warnings', ['employee_id', 'report_date'], {
      unique: true,
      name: 'daily_report_warnings_employee_date_unique',
      where: { deleted_at: null }
    });
    await queryInterface.addIndex('daily_report_warnings', ['employee_id', 'month_key', 'status'], { name: 'daily_report_warnings_employee_month_status_idx' });

    // ------------------------------------------------------------ escalation
    // One row per employee per calendar month. The unique index IS the
    // "send only one threshold-triggered HR escalation per employee per
    // month" rule — enforced by the database, so a retry mid-send collides
    // instead of producing a second email.
    await queryInterface.createTable('daily_report_escalations', {
      id: UUID_PK(Sequelize),
      employee_id: { ...userRef(Sequelize, false), onDelete: 'CASCADE' },
      month_key: { type: Sequelize.STRING(7), allowNull: false },
      // Active-warning count at the moment the threshold was crossed, kept
      // so the record still explains itself after a later waiver.
      warning_count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      missed_dates: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      notified_at: { type: Sequelize.DATE, allowNull: true },
      // Who was told, for the admin notification-delivery log.
      notified_usernames: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      email_status: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'pending' },
      email_error: { type: Sequelize.TEXT, allowNull: true },
      ...TIMESTAMPS(Sequelize)
    });
    await queryInterface.addIndex('daily_report_escalations', ['employee_id', 'month_key'], {
      unique: true,
      name: 'daily_report_escalations_employee_month_unique',
      where: { deleted_at: null }
    });

    // ------------------------------------------------- notification ledger
    // The idempotency record for every time-triggered side effect. The
    // scheduler claims a row here FIRST and only then sends, so a crash
    // between the two loses a notification rather than duplicating one —
    // the safe direction for something that emails real staff, and the
    // reason retries are safe to run as often as the host's cron likes.
    await queryInterface.createTable('daily_report_notification_events', {
      id: UUID_PK(Sequelize),
      employee_id: { ...userRef(Sequelize, false), onDelete: 'CASCADE' },
      report_date: { type: Sequelize.DATEONLY, allowNull: false },
      // 'REMINDER_EVENING' | 'REMINDER_FINAL' | 'WARNING' | 'SUBMITTED'.
      // 'SUBMITTED' is included so repeated submit requests cannot generate
      // duplicate manager notifications either.
      event_key: { type: Sequelize.STRING(32), allowNull: false },
      // When the event was DUE, as opposed to when it was processed — the
      // difference is what a catch-up run looks like in the admin log.
      due_at: { type: Sequelize.DATE, allowNull: true },
      processed_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      // 'sent' | 'skipped' | 'failed' | 'dry_run'
      status: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'sent' },
      channels: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      error: { type: Sequelize.TEXT, allowNull: true },
      ...TIMESTAMPS(Sequelize, { paranoid: false })
    });
    await queryInterface.addIndex('daily_report_notification_events', ['employee_id', 'report_date', 'event_key'], {
      unique: true,
      name: 'daily_report_notification_events_unique'
    });
    await queryInterface.addIndex('daily_report_notification_events', ['processed_at'], { name: 'daily_report_notification_events_processed_idx' });

    // -------------------------------------------------------- scheduler runs
    // Administrator-facing log of every sweep: what it did, what it would
    // have done in dry-run, and anything that failed. Without this, a
    // scheduler that silently stops looks identical to a month in which
    // everybody filed on time.
    await queryInterface.createTable('daily_report_scheduler_runs', {
      id: UUID_PK(Sequelize),
      job_key: { type: Sequelize.STRING(32), allowNull: false, defaultValue: 'daily_report_sweep' },
      started_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      finished_at: { type: Sequelize.DATE, allowNull: true },
      // 'running' | 'ok' | 'partial' | 'failed' | 'skipped'
      status: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'running' },
      dry_run: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      trigger: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'cron' },
      // Reporting dates considered, counts per event kind, failures.
      stats: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      error: { type: Sequelize.TEXT, allowNull: true },
      ...TIMESTAMPS(Sequelize, { paranoid: false })
    });
    await queryInterface.addIndex('daily_report_scheduler_runs', ['started_at'], { name: 'daily_report_scheduler_runs_started_idx' });

    // ---------------------------------------------------------------- RLS
    // See the file header: a new table under RLS with no policy denies the
    // app's own role everything, silently. Idempotent, and a no-op where the
    // role doesn't exist.
    await queryInterface.sequelize.query(`
      DO $$
      DECLARE t text;
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'matrixiq_vps') THEN
          RETURN;
        END IF;
        FOREACH t IN ARRAY ARRAY[
          'daily_report_config',
          'daily_report_templates',
          'daily_reports',
          'daily_report_entries',
          'daily_report_revisions',
          'daily_report_leave_claims',
          'daily_report_warnings',
          'daily_report_escalations',
          'daily_report_notification_events',
          'daily_report_scheduler_runs'
        ]
        LOOP
          IF NOT EXISTS (
            SELECT 1 FROM pg_policies p
            WHERE p.schemaname = 'public' AND p.tablename = t AND p.policyname = 'vps_all'
          ) THEN
            EXECUTE format('CREATE POLICY vps_all ON public.%I FOR ALL TO matrixiq_vps USING (true) WITH CHECK (true)', t);
          END IF;
        END LOOP;
      END $$;
    `);
  },

  async down(queryInterface) {
    // Children before parents — daily_report_entries/revisions reference
    // daily_reports, everything references users/departments.
    for (const table of [
      'daily_report_scheduler_runs',
      'daily_report_notification_events',
      'daily_report_escalations',
      'daily_report_warnings',
      'daily_report_leave_claims',
      'daily_report_revisions',
      'daily_report_entries',
      'daily_reports',
      'daily_report_templates',
      'daily_report_config'
    ]) {
      await queryInterface.dropTable(table);
    }
  }
};
