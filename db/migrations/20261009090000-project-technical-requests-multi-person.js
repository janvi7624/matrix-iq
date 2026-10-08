'use strict';

// A project's technical-person request used to be strictly one-at-a-time —
// enforced by a unique index on (project_id) WHERE status='pending', so a
// second pick replaced the first rather than coexisting. New Project
// creation now requires naming one or more technical people up front, each
// independently requested/approved, so several DIFFERENT people can
// legitimately be pending on the same project at once — only requesting the
// SAME person twice while they're still pending should be blocked.
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS project_technical_requests_one_pending');
    await queryInterface.sequelize.query(
      "CREATE UNIQUE INDEX IF NOT EXISTS project_technical_requests_one_pending_per_person ON project_technical_requests (project_id, requested_user_id) WHERE status = 'pending'"
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS project_technical_requests_one_pending_per_person');
    await queryInterface.sequelize.query(
      "CREATE UNIQUE INDEX IF NOT EXISTS project_technical_requests_one_pending ON project_technical_requests (project_id) WHERE status = 'pending'"
    );
  }
};
