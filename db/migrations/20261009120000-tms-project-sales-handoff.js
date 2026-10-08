'use strict';

/**
 * tms_projects.sales_project_id / sales_person_name / sales_person_username —
 * lib/tmsHandoff.ts opens a TMS project the moment a Sales project gets a
 * technical person assigned, but the only trace of where it came from was one
 * sentence buried in the free-text `description` column ("Handed off from
 * Sales project <id>."). That reads fine for one or two projects looked at by
 * hand; across hundreds it gives nobody a queryable, visible answer to "which
 * sales person handed this to which tech person" — exactly the gap this adds
 * structured columns for, so the TMS side can show it directly instead of
 * making an engineer go dig through a paragraph or ask around.
 *
 * Backfilled for every TMS project that already has a linked Sales project
 * (projects.tms_project_id) — the gap isn't just for new handoffs, it's the
 * whole existing backlog.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('tms_projects', 'sales_project_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'projects', key: 'id' },
      onDelete: 'SET NULL'
    });
    await queryInterface.addColumn('tms_projects', 'sales_person_name', {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: ''
    });
    await queryInterface.addColumn('tms_projects', 'sales_person_username', {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: ''
    });

    await queryInterface.sequelize.query(`
      UPDATE tms_projects AS t
      SET sales_project_id = p.id,
          sales_person_username = COALESCE(p.sales_person, ''),
          sales_person_name = COALESCE(u.name, p.sales_person, '')
      FROM projects AS p
      LEFT JOIN users AS u ON u.username = p.sales_person
      WHERE p.tms_project_id = t.id
    `);
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('tms_projects', 'sales_person_username');
    await queryInterface.removeColumn('tms_projects', 'sales_person_name');
    await queryInterface.removeColumn('tms_projects', 'sales_project_id');
  }
};
