'use strict';

// Sales Target register (Manager → Target Details). One row per employee per
// target period (monthly/quarterly/half-yearly/annual). Achievement is never
// stored here — it's always computed live from Quotation/Project rows (see
// lib/salesAchievement.ts) — this table only holds the manager-set goal.
//
// The unique index is partial (WHERE deleted_at IS NULL) so a soft-deleted
// target never blocks recreating a fresh one for the same employee+period.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('sales_targets', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },
      employee_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      // 'monthly' | 'quarterly' | 'half_yearly' | 'annual'
      period_type: { type: Sequelize.STRING(20), allowNull: false },
      period_start: { type: Sequelize.DATEONLY, allowNull: false },
      period_end: { type: Sequelize.DATEONLY, allowNull: false },
      // Human-facing label, e.g. "September 2026", "Q1 FY2026-27", "H1 FY2026-27", "FY 2026-27"
      display_period: { type: Sequelize.STRING, allowNull: false },
      // Indian financial year (Apr-Mar), e.g. "2026-27"
      fiscal_year: { type: Sequelize.STRING(7), allowNull: false },
      target_amount: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      // Manager/Khushi's running commentary for this target period — never an
      // achievement figure, so the weekly-update workflow can't create a
      // second, parallel source of truth for the amount.
      notes: { type: Sequelize.TEXT, allowNull: true },
      created_by: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      updated_by: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      deleted_at: { type: Sequelize.DATE, allowNull: true }
    });

    await queryInterface.addIndex('sales_targets', ['employee_id', 'period_type', 'period_start'], {
      unique: true,
      name: 'sales_targets_employee_period_unique',
      where: { deleted_at: null }
    });
    await queryInterface.addIndex('sales_targets', ['period_type', 'period_start'], { name: 'sales_targets_period_idx' });
    await queryInterface.addIndex('sales_targets', ['fiscal_year'], { name: 'sales_targets_fy_idx' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('sales_targets');
  }
};
