'use strict';

// Partner-requested demos.
//
// An overlay on demo_schedule, for the same reason the project overlay is an
// overlay: the existing approval chain (technical approval -> manager
// approval -> back office -> delivery challan -> demo -> return) is long,
// well-tested, and has nothing to do with who asked for the demo. A separate
// partner_demo_requests table would have meant either duplicating that chain
// or copying rows into demo_schedule on approval, which forks the id the
// partner is tracking.
//
// So a partner request IS a demo_schedule row from the start, carrying
// partner_id. Everything downstream — the eleven-value status enum, the
// approvals, the DC pipeline — runs completely unchanged; the partner simply
// sees a derived, coarser status (lib/partnerDemoStatus.ts).
//
// Note what is NOT added: nothing that would let a partner influence
// assignment. assigned_technical_person_id and technical_members stay purely
// internal, set through the existing approval routes.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('demo_schedule', 'partner_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'partners', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT'
    });

    // The specific portal user who asked, kept apart from created_by.
    // created_by must stay an INTERNAL account — it is the visibility key the
    // demo-schedule store scopes on (lib/demoScheduleStore.ts), exactly as
    // with projects.created_by. See lib/partnerDemoStore.ts.
    await queryInterface.addColumn('demo_schedule', 'requested_by_partner_user_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL'
    });

    // The partner-facing status note. Deliberately a SEPARATE column from
    // `notes`, which is where internal coordination already lives — reusing
    // it would publish internal demo chatter to the partner the moment this
    // feature shipped.
    await queryInterface.addColumn('demo_schedule', 'partner_remark', {
      type: Sequelize.TEXT,
      allowNull: true
    });

    // What the partner actually asked for, preserved verbatim. The internal
    // fields (products_demonstrated, scheduled_at) are what the team commits
    // to, and the two legitimately differ once coordination happens.
    await queryInterface.addColumn('demo_schedule', 'partner_requested_date', {
      type: Sequelize.DATE,
      allowNull: true
    });
    await queryInterface.addColumn('demo_schedule', 'partner_requirements', {
      type: Sequelize.TEXT,
      allowNull: true
    });

    await queryInterface.sequelize.query(
      'CREATE INDEX demo_schedule_partner_id_idx ON demo_schedule (partner_id) WHERE partner_id IS NOT NULL'
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS demo_schedule_partner_id_idx');
    await queryInterface.removeColumn('demo_schedule', 'partner_requirements');
    await queryInterface.removeColumn('demo_schedule', 'partner_requested_date');
    await queryInterface.removeColumn('demo_schedule', 'partner_remark');
    await queryInterface.removeColumn('demo_schedule', 'requested_by_partner_user_id');
    await queryInterface.removeColumn('demo_schedule', 'partner_id');
  }
};
