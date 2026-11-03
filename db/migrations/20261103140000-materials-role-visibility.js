'use strict';

// Narrowing a folder or a document to specific internal ROLES.
//
// DEFAULT [] on every existing row, and [] means "every internal role" —
// the exact opposite default to the partner_visible columns added in
// 20261020097000, and for the opposite reason. That migration was opening an
// internal library to an external audience, so nothing could be allowed
// through until Marketing said so item by item. This one narrows a library
// that every signed-in user could already read, so an empty list has to keep
// meaning what the absence of this column meant: everyone.
//
// Get that backwards and the migration hides all 11 documents and 9 folders
// from everyone at once.
//
// WHY AT ALL. The library is about to hold the role-by-role SoPs — a folder
// per role under "MatrixIQ SoP" — and fourteen sibling folders that all look
// equally relevant is worse structure than none. The rule itself, including
// the folder-chain gate that lets the parent stay open while the children
// are narrowed, is lib/materialRoleVisibility.ts.
//
// JSONB array rather than a join table, following partner_audience directly
// above it: a short list attached to one row, read with that row, that
// nobody queries from the other side.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('materials', 'visible_to_roles', {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: []
    });
    await queryInterface.addColumn('material_folders', 'visible_to_roles', {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: []
    });

    // Partial, like the partner_visible indexes: the restricted rows are the
    // small slice, and an index over "[] for almost everything" would earn
    // nothing. jsonb_array_length rather than <> '[]' so a row holding
    // literal null is not mistaken for a restriction.
    await queryInterface.sequelize.query(
      `CREATE INDEX materials_visible_to_roles_idx ON materials USING gin (visible_to_roles)
         WHERE jsonb_typeof(visible_to_roles) = 'array' AND jsonb_array_length(visible_to_roles) > 0`
    );
    await queryInterface.sequelize.query(
      `CREATE INDEX material_folders_visible_to_roles_idx ON material_folders USING gin (visible_to_roles)
         WHERE jsonb_typeof(visible_to_roles) = 'array' AND jsonb_array_length(visible_to_roles) > 0`
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS material_folders_visible_to_roles_idx');
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS materials_visible_to_roles_idx');
    await queryInterface.removeColumn('material_folders', 'visible_to_roles');
    await queryInterface.removeColumn('materials', 'visible_to_roles');
  }
};
