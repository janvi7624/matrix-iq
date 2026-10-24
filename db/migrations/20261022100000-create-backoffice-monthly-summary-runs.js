'use strict';

// Idempotency ledger for the "1st of month, email the Back Office manager
// last month's demo/expense summary" cron job
// (app/api/cron/backoffice-monthly-summary/route.ts).
//
// NOT audit_logs: that table's entity_id is a genuine UUID column (see
// db/models/auditLog.js) — a 'YYYY-MM' month key can never be stored there,
// so using it for this would fail on every single request. This mirrors
// db/migrations/...-create-daily-report-module.js's
// daily_report_notification_events instead: a unique index IS the claim —
// db.BackOfficeMonthlySummaryRun.create() is attempted first, and a
// SequelizeUniqueConstraintError means "already sent this month," the same
// claim-before-act idiom lib/dailyReportNotify.ts's claimNotificationEvent
// uses.
//
// RLS: see 20261014090000-create-daily-report-module.js's header comment —
// this database has RLS on with a single permissive policy per table for the
// app's own low-privilege role (matrixiq_vps); a new table with no policy
// denies that role everything, silently. Idempotent, and a no-op on a
// database with no such role (e.g. a local one).
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('back_office_monthly_summary_runs', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },
      month_key: { type: Sequelize.STRING(7), allowNull: false }, // 'YYYY-MM'
      sent_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      recipient_count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      demo_count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      total_expense: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 }
    });

    await queryInterface.addIndex('back_office_monthly_summary_runs', ['month_key'], {
      unique: true,
      name: 'back_office_monthly_summary_runs_month_key_unique'
    });

    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'matrixiq_vps') THEN
          RETURN;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_policies p
          WHERE p.schemaname = 'public' AND p.tablename = 'back_office_monthly_summary_runs' AND p.policyname = 'vps_all'
        ) THEN
          CREATE POLICY vps_all ON public.back_office_monthly_summary_runs FOR ALL TO matrixiq_vps USING (true) WITH CHECK (true);
        END IF;
      END $$;
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('back_office_monthly_summary_runs');
  }
};
