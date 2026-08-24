module.exports = (sequelize, DataTypes) => {
  const TravelSchedule = sequelize.define('TravelSchedule', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    created_by: { type: DataTypes.UUID },
    request_code: { type: DataTypes.STRING(20) },
    status: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'draft' },
    origin: { type: DataTypes.STRING },
    destination: { type: DataTypes.STRING },
    start_date: { type: DataTypes.DATEONLY },
    end_date: { type: DataTypes.DATEONLY },
    required_arrival_time: { type: DataTypes.STRING },
    expected_departure_time: { type: DataTypes.STRING },
    purpose: { type: DataTypes.TEXT },
    linked_client: { type: DataTypes.STRING },
    expense_note: { type: DataTypes.TEXT },
    project_id: { type: DataTypes.UUID },
    // Stage 2: Department Manager
    manager_id: { type: DataTypes.UUID },
    manager_action_at: { type: DataTypes.DATE },
    manager_remarks: { type: DataTypes.TEXT },
    // Stage 3: HR Review
    hr_reviewer_id: { type: DataTypes.UUID },
    hr_reviewed_at: { type: DataTypes.DATE },
    hr_remarks: { type: DataTypes.TEXT },
    hr_documents: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    estimated_cost: { type: DataTypes.DECIMAL(12, 2) },
    // Stage 4: Admin Review
    admin_reviewer_id: { type: DataTypes.UUID },
    admin_reviewed_at: { type: DataTypes.DATE },
    admin_remarks: { type: DataTypes.TEXT },
    // Stage 5: Accounts (Ticket Booking)
    accounts_handler_id: { type: DataTypes.UUID },
    accounts_completed_at: { type: DataTypes.DATE },
    booking_details: { type: DataTypes.TEXT },
    ticket_documents: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    actual_cost: { type: DataTypes.DECIMAL(12, 2) },
    // Stage 6: HR Final Verification
    hr_final_verifier_id: { type: DataTypes.UUID },
    hr_final_verified_at: { type: DataTypes.DATE },
    hr_final_remarks: { type: DataTypes.TEXT },
    // Companions (other travellers)
    companion_ids: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    // Change request tracking
    change_request_remarks: { type: DataTypes.TEXT },
    change_requested_by: { type: DataTypes.STRING }
  }, {
    tableName: 'travel_schedule',
    underscored: true,
    paranoid: false
  });

  TravelSchedule.associate = (models) => {
    TravelSchedule.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
    TravelSchedule.belongsTo(models.Project, { foreignKey: 'project_id', as: 'project' });
    TravelSchedule.belongsTo(models.User, { foreignKey: 'manager_id', as: 'manager' });
    TravelSchedule.belongsTo(models.User, { foreignKey: 'hr_reviewer_id', as: 'hrReviewer' });
    TravelSchedule.belongsTo(models.User, { foreignKey: 'admin_reviewer_id', as: 'adminReviewer' });
    TravelSchedule.belongsTo(models.User, { foreignKey: 'accounts_handler_id', as: 'accountsHandler' });
    TravelSchedule.belongsTo(models.User, { foreignKey: 'hr_final_verifier_id', as: 'hrFinalVerifier' });
  };

  return TravelSchedule;
};
