'use strict';

/**
 * One additive enum value: general_tasks.status gains 'declined', so an
 * assignee can refuse a task that was given to them instead of silently
 * sitting on it.
 *
 * Deliberately NOT reusing the existing 'rejected' value. That one is a
 * REVIEWER outcome — app/api/general-tasks/[id]/review/route.ts maps
 * approve/rework/reject onto approved/rework_required/rejected — and means
 * "the submitted work was not good enough". An assignee declining the job
 * before (or instead of) doing it is a different event with a different
 * actor and a different follow-up (reassign, not redo), and folding the two
 * together would make every "how much submitted work gets rejected" answer
 * wrong from here on.
 *
 * The reason itself needs no column: it is written to general_task_updates
 * via recordTaskUpdate, the same place every other status change records its
 * work summary and remarks, so it shows up in the task's existing history.
 *
 * Added the same additive way as 20260810220000's marketing statuses —
 * existing rows and values are untouched.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query('ALTER TYPE "enum_general_tasks_status" ADD VALUE IF NOT EXISTS \'declined\';');
  },

  async down() {
    // Postgres cannot drop a single enum value without rebuilding the type
    // and rewriting every column that uses it, so this is deliberately a
    // no-op: an unused extra value is harmless, and the rebuild is not worth
    // the risk to live task rows. Same stance as the other additive enum
    // migrations in this directory.
  }
};
