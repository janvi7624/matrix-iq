'use strict';

// The schema migration (20260926090000) only added the column — every
// project that was already Won/Lost before today would otherwise sit with
// closed_at NULL forever (nothing re-touches a done deal's status), which
// means the very clutter this feature exists to clear never actually clears.
// Backfills from that project's own timeline history: the "Closed as won" /
// stage-advanced-to-closed_lost event's timestamp when one exists, else
// updated_at as the best remaining guess. Never touches an open project.
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      UPDATE projects p
      SET closed_at = COALESCE(
        (
          SELECT MAX(pte.at) FROM project_timeline_events pte
          WHERE pte.project_id = p.id
            AND (
              (p.status = 'won' AND (pte.stage = 'completed' OR pte.label ILIKE 'Closed as won%'))
              OR (p.status = 'lost' AND pte.stage = 'closed_lost')
            )
        ),
        p.updated_at
      )
      WHERE p.status IN ('won', 'lost') AND p.closed_at IS NULL;
    `);
  },
  async down(queryInterface) {
    await queryInterface.sequelize.query(`UPDATE projects SET closed_at = NULL WHERE status IN ('won', 'lost');`);
  }
};
