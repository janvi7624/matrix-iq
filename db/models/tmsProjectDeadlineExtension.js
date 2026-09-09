module.exports = (sequelize, DataTypes) => {
  const TmsProjectDeadlineExtension = sequelize.define('TmsProjectDeadlineExtension', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    tms_project_id: { type: DataTypes.UUID, allowNull: false },
    previous_deadline: { type: DataTypes.DATEONLY },
    new_deadline: { type: DataTypes.DATEONLY, allowNull: false },
    remark: { type: DataTypes.TEXT, allowNull: false },
    attachments: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    // Who REQUESTED this extension — kept its original column name (it meant
    // "who did the extension" before approval existed; now it's the
    // requester, which for an admin's own auto-approved request is the same
    // person as approved_by).
    extended_by: { type: DataTypes.UUID },
    reason: { type: DataTypes.ENUM('user_end', 'client_end'), allowNull: false, defaultValue: 'user_end' },
    status: { type: DataTypes.ENUM('pending_manager', 'pending_admin', 'approved', 'rejected'), allowNull: false, defaultValue: 'approved' },
    approved_by: { type: DataTypes.UUID },
    approved_at: { type: DataTypes.DATE },
    decision_remark: { type: DataTypes.TEXT }
  }, {
    tableName: 'tms_project_deadline_extensions',
    underscored: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false
  });

  TmsProjectDeadlineExtension.associate = (models) => {
    TmsProjectDeadlineExtension.belongsTo(models.TmsProject, { foreignKey: 'tms_project_id', as: 'project' });
    TmsProjectDeadlineExtension.belongsTo(models.User, { foreignKey: 'extended_by', as: 'extendedBy' });
    TmsProjectDeadlineExtension.belongsTo(models.User, { foreignKey: 'approved_by', as: 'approvedBy' });
  };

  return TmsProjectDeadlineExtension;
};
