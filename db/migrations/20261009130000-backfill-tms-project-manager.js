'use strict';

/**
 * lib/tmsHandoff.ts has always set project_manager_id = the assigned
 * technical person at creation time — but that line is a past fix, not
 * something retroactive, so any TMS project created before it (or by some
 * other gap in the handoff path) is stuck with no project manager and, until
 * this migration's sibling UI change, NO way to set one from the TMS side at
 * all. Backfilled from the linked Sales project's assigned_technical_person_id
 * (now resolvable via sales_project_id, added just before this migration) —
 * only for rows that are still genuinely unset, never overwriting a manager
 * someone already assigned or changed since.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      UPDATE tms_projects AS t
      SET project_manager_id = p.assigned_technical_person_id
      FROM projects AS p
      WHERE t.sales_project_id = p.id
        AND t.project_manager_id IS NULL
        AND p.assigned_technical_person_id IS NOT NULL
    `);
  },

  async down() {
    // Data backfill only — no schema change, and re-blanking a now-set
    // manager on rollback would be destructive for no benefit.
  }
};
