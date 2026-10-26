'use strict';

/**
 * Permission to edit a report that has already been filed.
 *
 * Submitting is now terminal: nobody — not the employee, not their manager —
 * rewrites a SUBMITTED report directly. The employee asks their DEPARTMENT
 * MANAGER, who approves or refuses, and an approval is a single-use grant
 * that one save spends.
 *
 * Shaped on daily_report_leave_claims (20261014090000), the module's existing
 * request->approve record, down to the denormalised department_id and
 * report_date: the manager's queue groups by department without a join, and a
 * later transfer does not rewrite history.
 *
 * Deliberately NOT named reviewed_by/reviewed_at like the leave claim. Manager
 * "review" was just removed from this module, and reusing those column names
 * would read as the feature that went away.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('daily_report_edit_requests', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },
      report_id: { type: Sequelize.UUID, allowNull: false },
      employee_id: { type: Sequelize.UUID, allowNull: false },
      // Denormalised for the same reason the leave claim denormalises it.
      department_id: { type: Sequelize.UUID },
      report_date: { type: Sequelize.DATEONLY, allowNull: false },
      // Why the filed report needs changing. Mandatory: an edit to a filed
      // record is exactly the thing somebody may later be asked to justify.
      reason: { type: Sequelize.TEXT, allowNull: false },
      // 'PENDING' | 'APPROVED' | 'REJECTED' | 'USED' | 'EXPIRED'
      status: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'PENDING' },
      decided_by: { type: Sequelize.UUID },
      decided_at: { type: Sequelize.DATE },
      decision_reason: { type: Sequelize.TEXT },
      // An approval is not open-ended. After this instant the grant is spent
      // whether or not it was used, so a forgotten approval cannot be
      // redeemed weeks later against a report nobody is looking at.
      grant_expires_at: { type: Sequelize.DATE },
      used_at: { type: Sequelize.DATE },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      deleted_at: { type: Sequelize.DATE }
    });

    // One LIVE request per report. REJECTED, USED and EXPIRED are excluded so
    // a refusal does not permanently bar asking again, and so a spent grant
    // does not block the next genuine request. This index is the real
    // duplicate guard — the store's findOne pre-check exists only to produce a
    // readable message instead of a constraint error.
    await queryInterface.addIndex('daily_report_edit_requests', ['report_id'], {
      unique: true,
      name: 'daily_report_edit_requests_one_live',
      where: { deleted_at: null, status: ['PENDING', 'APPROVED'] }
    });

    // The manager's queue: pending first, newest dates first.
    await queryInterface.addIndex('daily_report_edit_requests', ['status', 'report_date'], {
      name: 'daily_report_edit_requests_queue_idx'
    });
    await queryInterface.addIndex('daily_report_edit_requests', ['employee_id'], {
      name: 'daily_report_edit_requests_employee_idx'
    });

    // A new table that ends up with RLS enabled and no policy denies every
    // read and write SILENTLY — see 20260928120000-vps-rls-policy-for-missing-
    // tables.js for the incident this traces back to. Idempotent, and a no-op
    // on a database that has no matrixiq_vps role (a developer's local copy).
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'matrixiq_vps') THEN
          RETURN;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_policies p
          WHERE p.schemaname = 'public' AND p.tablename = 'daily_report_edit_requests' AND p.policyname = 'vps_all'
        ) THEN
          CREATE POLICY vps_all ON public.daily_report_edit_requests FOR ALL TO matrixiq_vps USING (true) WITH CHECK (true);
        END IF;
      END $$;
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('daily_report_edit_requests');
  }
};
