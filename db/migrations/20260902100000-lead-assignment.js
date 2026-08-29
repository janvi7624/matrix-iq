'use strict';

/**
 * Lead assignment — a sales manager routes captured leads/inquiries to the
 * reps who will work them.
 *
 * Three additive columns on `leads`, all nullable so every existing row stays
 * valid as "captured but not yet assigned":
 *   1. assigned_to_id — the rep who owns working this lead. Deliberately its
 *      own column rather than reusing `created_by`: who *captured* a lead (at
 *      a trade show, via bulk import, or by OCR'ing a card) is a different
 *      fact from who is *responsible* for it, and both need to survive. It
 *      also means reassignment never rewrites capture history.
 *   2. assigned_by_id — which manager made the call, for accountability.
 *   3. assigned_at — when, so "assigned but untouched for N days" is
 *      answerable later without trawling the audit log.
 *
 * The index on assigned_to_id backs the new visibility rule in
 * lib/leadStore.ts: a lead is now visible to its assignee as well as to the
 * department scope of whoever captured it, so this column is filtered on in
 * every lead list query.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('leads', 'assigned_to_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE'
    });

    await queryInterface.addColumn('leads', 'assigned_by_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE'
    });

    await queryInterface.addColumn('leads', 'assigned_at', {
      type: Sequelize.DATE,
      allowNull: true
    });

    await queryInterface.addIndex('leads', ['assigned_to_id'], { name: 'leads_assigned_to_id_idx' });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('leads', 'leads_assigned_to_id_idx');
    await queryInterface.removeColumn('leads', 'assigned_at');
    await queryInterface.removeColumn('leads', 'assigned_by_id');
    await queryInterface.removeColumn('leads', 'assigned_to_id');
  }
};
