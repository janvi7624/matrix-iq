'use strict';

/**
 * Extends the travel_schedule table from a simple CRUD log into a full
 * multi-stage approval workflow:
 *
 *   Employee submits -> Department Manager approves -> HR reviews (adds
 *   costing/docs) -> Admin approves -> Accounts books tickets -> HR final
 *   verification -> Employee receives confirmed travel details.
 *
 * New columns track each stage's actor, timestamp, remarks, and any
 * documents/costing added along the way.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const userFk = () => ({
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE'
    });

    // Status enum — travel_schedule currently has no status column at all.
    await queryInterface.addColumn('travel_schedule', 'status', {
      type: Sequelize.STRING(40),
      allowNull: false,
      defaultValue: 'draft'
    });

    // Project link (employee selects from project dashboard)
    await queryInterface.addColumn('travel_schedule', 'project_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'projects', key: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE'
    });

    // Required arrival & expected departure (timestamps, not just dates)
    await queryInterface.addColumn('travel_schedule', 'required_arrival_time', { type: Sequelize.DATE });
    await queryInterface.addColumn('travel_schedule', 'expected_departure_time', { type: Sequelize.DATE });

    // --- Stage 2: Department Manager ---
    await queryInterface.addColumn('travel_schedule', 'manager_id', userFk());
    await queryInterface.addColumn('travel_schedule', 'manager_action_at', { type: Sequelize.DATE });
    await queryInterface.addColumn('travel_schedule', 'manager_remarks', { type: Sequelize.TEXT });

    // --- Stage 3: HR Review ---
    await queryInterface.addColumn('travel_schedule', 'hr_reviewer_id', userFk());
    await queryInterface.addColumn('travel_schedule', 'hr_reviewed_at', { type: Sequelize.DATE });
    await queryInterface.addColumn('travel_schedule', 'hr_remarks', { type: Sequelize.TEXT });
    await queryInterface.addColumn('travel_schedule', 'hr_documents', { type: Sequelize.JSONB, allowNull: false, defaultValue: [] });
    await queryInterface.addColumn('travel_schedule', 'estimated_cost', { type: Sequelize.DECIMAL(12, 2) });

    // --- Stage 4: Admin Review ---
    await queryInterface.addColumn('travel_schedule', 'admin_reviewer_id', userFk());
    await queryInterface.addColumn('travel_schedule', 'admin_reviewed_at', { type: Sequelize.DATE });
    await queryInterface.addColumn('travel_schedule', 'admin_remarks', { type: Sequelize.TEXT });

    // --- Stage 5: Accounts (Ticket Booking) ---
    await queryInterface.addColumn('travel_schedule', 'accounts_handler_id', userFk());
    await queryInterface.addColumn('travel_schedule', 'accounts_completed_at', { type: Sequelize.DATE });
    await queryInterface.addColumn('travel_schedule', 'booking_details', { type: Sequelize.TEXT });
    await queryInterface.addColumn('travel_schedule', 'ticket_documents', { type: Sequelize.JSONB, allowNull: false, defaultValue: [] });
    await queryInterface.addColumn('travel_schedule', 'actual_cost', { type: Sequelize.DECIMAL(12, 2) });

    // --- Stage 6: HR Final Verification ---
    await queryInterface.addColumn('travel_schedule', 'hr_final_verifier_id', userFk());
    await queryInterface.addColumn('travel_schedule', 'hr_final_verified_at', { type: Sequelize.DATE });
    await queryInterface.addColumn('travel_schedule', 'hr_final_remarks', { type: Sequelize.TEXT });

    // Change-request tracking (when any stage sends back for corrections)
    await queryInterface.addColumn('travel_schedule', 'change_request_remarks', { type: Sequelize.TEXT });
    await queryInterface.addColumn('travel_schedule', 'change_requested_by', { type: Sequelize.STRING });

    // Request code for display (TR-0001, TR-0002, ...)
    await queryInterface.addColumn('travel_schedule', 'request_code', { type: Sequelize.STRING(20) });
  },

  async down(queryInterface) {
    const cols = [
      'request_code', 'change_requested_by', 'change_request_remarks',
      'hr_final_remarks', 'hr_final_verified_at', 'hr_final_verifier_id',
      'actual_cost', 'ticket_documents', 'booking_details', 'accounts_completed_at', 'accounts_handler_id',
      'admin_remarks', 'admin_reviewed_at', 'admin_reviewer_id',
      'estimated_cost', 'hr_documents', 'hr_remarks', 'hr_reviewed_at', 'hr_reviewer_id',
      'manager_remarks', 'manager_action_at', 'manager_id',
      'expected_departure_time', 'required_arrival_time',
      'project_id', 'status'
    ];
    for (const col of cols) {
      await queryInterface.removeColumn('travel_schedule', col);
    }
  }
};
