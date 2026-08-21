module.exports = (sequelize, DataTypes) => {
  const TmsBomRequest = sequelize.define('TmsBomRequest', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    bom_request_code: { type: DataTypes.STRING, unique: true },
    project_id: { type: DataTypes.UUID, allowNull: false },
    requested_by_id: { type: DataTypes.UUID },
    department_id: { type: DataTypes.UUID },
    request_date: { type: DataTypes.DATEONLY },
    required_date: { type: DataTypes.DATEONLY },
    item_name: { type: DataTypes.STRING },
    item_description: { type: DataTypes.TEXT },
    part_number: { type: DataTypes.STRING },
    quantity: { type: DataTypes.INTEGER },
    specification: { type: DataTypes.TEXT },
    preferred_brand: { type: DataTypes.STRING },
    estimated_cost: { type: DataTypes.DECIMAL(14, 2) },
    remarks: { type: DataTypes.TEXT },
    attachments: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    status: {
      type: DataTypes.ENUM(
        'draft', 'submitted', 'under_review', 'approved', 'rejected', 'sent_for_procurement', 'completed',
        'admin_approved', 'finance_approved', 'payment_done', 'received'
      ),
      allowNull: false,
      defaultValue: 'draft'
    },
    rejection_reason: { type: DataTypes.TEXT },
    reviewed_by_id: { type: DataTypes.UUID },
    reviewed_at: { type: DataTypes.DATE },
    // Administration stage (approved -> admin_approved) — the actor is
    // resolved from Department.managerIds for the "Administration"
    // department, same mechanism as the Accounts stage below.
    admin_reviewed_by_id: { type: DataTypes.UUID },
    admin_reviewed_at: { type: DataTypes.DATE },
    // Finance Approver stage (admin_approved -> finance_approved) — the approver
    // is whoever is configured as AppConfig.bomFinanceApproverId, not a
    // hardcoded account.
    finance_reviewed_by_id: { type: DataTypes.UUID },
    finance_reviewed_at: { type: DataTypes.DATE },
    // Accounts payment stage (finance_approved -> payment_done) — the actor
    // is resolved from Department.managerIds for the "Accounts" department,
    // same mechanism as demo-schedule/marketing-requests routing.
    payment_marked_by_id: { type: DataTypes.UUID },
    payment_marked_at: { type: DataTypes.DATE },
    payment_proof_attachments: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    // Material-received stage (payment_done -> received) — only the original
    // requester (or a privileged override).
    received_by_id: { type: DataTypes.UUID },
    received_at: { type: DataTypes.DATE },
    created_by: { type: DataTypes.UUID }
  }, {
    tableName: 'tms_bom_requests',
    underscored: true,
    paranoid: true
  });

  TmsBomRequest.associate = (models) => {
    TmsBomRequest.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
    TmsBomRequest.belongsTo(models.User, { foreignKey: 'requested_by_id', as: 'requestedBy' });
    TmsBomRequest.belongsTo(models.User, { foreignKey: 'reviewed_by_id', as: 'reviewedBy' });
    TmsBomRequest.belongsTo(models.User, { foreignKey: 'admin_reviewed_by_id', as: 'adminReviewedBy' });
    TmsBomRequest.belongsTo(models.User, { foreignKey: 'finance_reviewed_by_id', as: 'financeReviewedBy' });
    TmsBomRequest.belongsTo(models.User, { foreignKey: 'payment_marked_by_id', as: 'paymentMarkedBy' });
    TmsBomRequest.belongsTo(models.User, { foreignKey: 'received_by_id', as: 'receivedBy' });
    TmsBomRequest.belongsTo(models.Department, { foreignKey: 'department_id', as: 'department' });
    TmsBomRequest.belongsTo(models.TmsProject, { foreignKey: 'project_id', as: 'project' });
    TmsBomRequest.hasMany(models.TmsProcurement, { foreignKey: 'bom_request_id', as: 'procurements' });
  };

  return TmsBomRequest;
};
