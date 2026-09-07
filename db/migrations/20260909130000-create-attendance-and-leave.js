'use strict';

// Attendance = a simple per-day register (who was present), separate from
// any HR TASK that might remind someone to go verify it. Leave = request +
// approval only, no balance/accrual engine (no policy precedent exists
// anywhere in this app for that).
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('attendance_records', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },
      user_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      date: { type: Sequelize.DATEONLY, allowNull: false },
      status: { type: Sequelize.ENUM('present', 'absent', 'half_day', 'on_leave', 'holiday', 'wfh'), allowNull: false },
      marked_by: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      remarks: { type: Sequelize.TEXT },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') }
    });
    await queryInterface.addIndex('attendance_records', ['user_id', 'date'], { unique: true, name: 'attendance_records_user_date_unique' });
    await queryInterface.addIndex('attendance_records', ['date'], { name: 'attendance_records_date_idx' });

    await queryInterface.createTable('leave_requests', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },
      user_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      leave_type: { type: Sequelize.ENUM('casual', 'sick', 'earned', 'unpaid', 'other'), allowNull: false },
      start_date: { type: Sequelize.DATEONLY, allowNull: false },
      end_date: { type: Sequelize.DATEONLY, allowNull: false },
      days: { type: Sequelize.DECIMAL(4, 1), allowNull: false },
      reason: { type: Sequelize.TEXT },
      status: { type: Sequelize.ENUM('pending', 'approved', 'rejected', 'cancelled'), allowNull: false, defaultValue: 'pending' },
      approved_by: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      approved_at: { type: Sequelize.DATE, allowNull: true },
      remarks: { type: Sequelize.TEXT },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') }
    });
    await queryInterface.addIndex('leave_requests', ['user_id', 'status'], { name: 'leave_requests_user_status_idx' });
    await queryInterface.addIndex('leave_requests', ['start_date', 'end_date'], { name: 'leave_requests_date_range_idx' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('leave_requests');
    await queryInterface.dropTable('attendance_records');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_leave_requests_leave_type";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_leave_requests_status";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_attendance_records_status";');
  }
};
