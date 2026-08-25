module.exports = (sequelize, DataTypes) => {
  const ReimbursementSheet = sequelize.define('ReimbursementSheet', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    created_by: { type: DataTypes.UUID, allowNull: false },
    sheet_code: { type: DataTypes.STRING(30) },
    month: { type: DataTypes.INTEGER, allowNull: false },
    year: { type: DataTypes.INTEGER, allowNull: false },
    status: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'draft' },
    // Stage 2: Department Manager
    manager_id: { type: DataTypes.UUID },
    manager_action_at: { type: DataTypes.DATE },
    manager_remarks: { type: DataTypes.TEXT },
    // Stage 3: HR Review
    hr_reviewer_id: { type: DataTypes.UUID },
    hr_reviewed_at: { type: DataTypes.DATE },
    hr_remarks: { type: DataTypes.TEXT },
    // Stage 4: Accounts (Payment)
    accounts_handler_id: { type: DataTypes.UUID },
    accounts_completed_at: { type: DataTypes.DATE },
    accounts_remarks: { type: DataTypes.TEXT },
    payment_reference: { type: DataTypes.STRING },
    // Change request tracking
    change_request_remarks: { type: DataTypes.TEXT },
    change_requested_by: { type: DataTypes.STRING }
  }, {
    tableName: 'reimbursement_sheets',
    underscored: true,
    paranoid: false
  });

  ReimbursementSheet.associate = (models) => {
    ReimbursementSheet.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
    ReimbursementSheet.belongsTo(models.User, { foreignKey: 'manager_id', as: 'manager' });
    ReimbursementSheet.belongsTo(models.User, { foreignKey: 'hr_reviewer_id', as: 'hrReviewer' });
    ReimbursementSheet.belongsTo(models.User, { foreignKey: 'accounts_handler_id', as: 'accountsHandler' });
  };

  return ReimbursementSheet;
};
