'use strict';

// Who opened which piece of collateral.
//
// Append-only, and kept as its own table rather than a counter column on
// `materials` for two reasons. A counter answers "how many times" and
// nothing else — it cannot answer "which partners are actually using the
// robotics brochure", which is the question Marketing asks. And a counter is
// a hot UPDATE on a row every other read also touches, where this is an
// INSERT that never contends.
//
// No foreign key to partners deliberately: the log must survive a partner
// row being changed or a user being deleted, and it is written on a hot path
// where a constraint check buys nothing. material_id does carry one, with
// CASCADE — a deleted document's access history is meaningless.
//
// Note this records ACCESS, not consent. It exists so Marketing can see what
// is useful; it is not a surveillance feature and the partner-facing UI says
// nothing about it.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('material_access_logs', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },
      material_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'materials', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      // No FK — see the header comment.
      user_id: { type: Sequelize.UUID, allowNull: true },
      // Null for an internal user; set for a partner so usage can be
      // attributed per partner company without joining back through users.
      partner_id: { type: Sequelize.UUID, allowNull: true },
      // 'view' | 'download'. This library stores links rather than blobs, so
      // in practice everything is 'view' today; the column exists so the
      // distinction can be recorded if files ever move into our own storage.
      action: { type: Sequelize.STRING(10), allowNull: false, defaultValue: 'view' },
      at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') }
    });

    await queryInterface.addIndex('material_access_logs', ['material_id', 'at'], { name: 'material_access_logs_material_idx' });
    await queryInterface.sequelize.query(
      'CREATE INDEX material_access_logs_partner_idx ON material_access_logs (partner_id, at DESC) WHERE partner_id IS NOT NULL'
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS material_access_logs_partner_idx');
    await queryInterface.removeIndex('material_access_logs', 'material_access_logs_material_idx');
    await queryInterface.dropTable('material_access_logs');
  }
};
