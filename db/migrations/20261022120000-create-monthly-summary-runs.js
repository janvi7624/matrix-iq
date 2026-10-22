'use strict';

/**
 * Generic idempotency ledger for "on the 1st of the month, email someone a
 * summary of last month" jobs — the Daily Report department-manager summary
 * and the Daily Report all-departments admin brief both claim a row here
 * before sending (app/api/cron/daily-report-monthly-summary).
 *
 * Deliberately NOT a dedicated table per job the way
 * back_office_monthly_summary_runs is (20261022100000) — that one predates
 * this file and is left as-is (no reason to migrate working data), but with
 * a second AND third monthly-summary job landing in the same piece of work,
 * one shared table keyed by (job_key, scope_key, month_key) is the right
 * level of reuse: a new monthly job going forward can claim a row here
 * without its own migration.
 *
 * month_key is 'YYYY-MM'. scope_key is job-specific — a department id for
 * the per-department summary, the literal 'all' for the admin brief. The
 * unique index on all three IS the claim: db.MonthlySummaryRun.create() is
 * attempted first, and a SequelizeUniqueConstraintError means some call
 * already claimed this (job, scope, month) — the same claim-then-act idiom
 * lib/dailyReportNotify.ts's claimNotificationEvent uses.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('monthly_summary_runs', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },
      job_key: { type: Sequelize.STRING(64), allowNull: false },
      scope_key: { type: Sequelize.STRING(64), allowNull: false },
      month_key: { type: Sequelize.STRING(7), allowNull: false },
      sent_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      recipient_count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 }
    });

    await queryInterface.addIndex('monthly_summary_runs', ['job_key', 'scope_key', 'month_key'], {
      unique: true,
      name: 'monthly_summary_runs_job_scope_month_unique'
    });

    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'matrixiq_vps') THEN
          RETURN;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_policies p
          WHERE p.schemaname = 'public' AND p.tablename = 'monthly_summary_runs' AND p.policyname = 'vps_all'
        ) THEN
          CREATE POLICY vps_all ON public.monthly_summary_runs FOR ALL TO matrixiq_vps USING (true) WITH CHECK (true);
        END IF;
      END $$;
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('monthly_summary_runs');
  }
};
