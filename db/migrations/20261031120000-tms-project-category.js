'use strict';

/**
 * Project Category on the TMS "New Project" form — R&D / Development /
 * Client, or a typed value when 'Other' is picked. Free text, not an ENUM,
 * since 'Other' can hold anything (see db/models/tmsProject.js). Nullable
 * and optional: every project created before this field existed has no
 * category and that's fine, not a data problem to backfill.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('tms_projects', 'project_category', { type: Sequelize.STRING });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('tms_projects', 'project_category');
  }
};
