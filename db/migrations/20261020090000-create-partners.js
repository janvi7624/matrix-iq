'use strict';

// Partner company master — the tenancy root for the Partner Portal.
//
// A partner is an EXTERNAL company (channel partner, distributor, dealer)
// that logs in through the same MatrixIQ login page as staff. Their login
// accounts are ordinary `users` rows carrying `partner_id` (added by the
// next migration); this table is the company those accounts belong to.
//
// `status` is the kill switch. It is checked live on every partner request
// (lib/partnerContext.ts), not baked into the session token, so suspending a
// partner takes effect on their very next call rather than at their next
// login — the same reasoning that already governs `users.status` in
// lib/viewerContext.ts.
//
// relationship_manager_id is ON DELETE SET NULL rather than RESTRICT: an
// internal RM leaving the company must not block anything, and the partner
// simply shows as unassigned until someone re-assigns them. Every other
// partner-owned table points the other way (at this table) with RESTRICT,
// so a partner holding live records cannot be dropped out from under them.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('partners', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },
      // Human-facing reference used on screens and in conversation ("PTR-0007"),
      // never the UUID. Generated in lib/partnerStore.ts.
      partner_code: { type: Sequelize.STRING(32), allowNull: false },
      company_name: { type: Sequelize.STRING(255), allowNull: false },
      contact_person: { type: Sequelize.STRING(255), allowNull: true },
      email: { type: Sequelize.STRING(255), allowNull: true },
      phone: { type: Sequelize.STRING(40), allowNull: true },
      address: { type: Sequelize.TEXT, allowNull: true },
      city: { type: Sequelize.STRING(120), allowNull: true },
      state: { type: Sequelize.STRING(120), allowNull: true },
      country: { type: Sequelize.STRING(120), allowNull: true },
      gst_number: { type: Sequelize.STRING(32), allowNull: true },
      // pending | active | suspended | inactive. A plain STRING, not an ENUM,
      // matching the newer tables in this schema (projects.lead_confirmation_status,
      // demo_schedule.mode) — Postgres cannot drop an ENUM value, and this
      // list is business policy rather than a fixed invariant.
      status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'pending' },
      // Reuses lib/projectDepartmentOptions.ts values ('ai' | 'av' | 'robotics')
      // so a partner's departments and a project's departments are the same
      // vocabulary, not two lists that drift.
      departments: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      product_categories: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      territory: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      // The internal owner of this relationship. Partner submissions are
      // attributed to this person so the existing department-scoped
      // visibility rules (lib/departmentScope.ts) keep working untouched.
      relationship_manager_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      notes: { type: Sequelize.TEXT, allowNull: true },
      created_by: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      updated_by: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      deleted_at: { type: Sequelize.DATE, allowNull: true }
    });

    // Partial unique index rather than a plain `unique: true` on the column:
    // this table is paranoid, and a soft-deleted partner must not reserve its
    // code forever. Mirrors the reasoning already documented in
    // lib/roleStore.ts's createRole about non-partial unique indexes.
    await queryInterface.sequelize.query(
      'CREATE UNIQUE INDEX partners_partner_code_unique ON partners (partner_code) WHERE deleted_at IS NULL'
    );
    await queryInterface.addIndex('partners', ['status'], { name: 'partners_status_idx' });
    await queryInterface.addIndex('partners', ['relationship_manager_id'], { name: 'partners_rm_idx' });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('partners', 'partners_rm_idx');
    await queryInterface.removeIndex('partners', 'partners_status_idx');
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS partners_partner_code_unique');
    await queryInterface.dropTable('partners');
  }
};
