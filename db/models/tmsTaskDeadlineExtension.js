module.exports = (sequelize, DataTypes) => {
  // One row per request to move a TMS task's due date. Immutable history: the
  // task's own due_date is only written when a row reaches 'approved', so the
  // date and the reason it moved can never drift apart. Mirrors
  // db/models/tmsProjectDeadlineExtension.js.
  const TmsTaskDeadlineExtension = sequelize.define('TmsTaskDeadlineExtension', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    task_id: { type: DataTypes.UUID, allowNull: false },
    // Null when the task had no due date before — setting one still records.
    previous_deadline: { type: DataTypes.DATEONLY },
    new_deadline: { type: DataTypes.DATEONLY, allowNull: false },
    remark: { type: DataTypes.TEXT, allowNull: false },
    attachments: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    /** Who REQUESTED it. Same column name as the project table. */
    extended_by: { type: DataTypes.UUID },
    reason: { type: DataTypes.ENUM('user_end', 'client_end'), allowNull: false, defaultValue: 'user_end' },
    status: {
      type: DataTypes.ENUM('pending_manager', 'pending_admin', 'approved', 'rejected'),
      allowNull: false,
      defaultValue: 'approved'
    },
    approved_by: { type: DataTypes.UUID },
    approved_at: { type: DataTypes.DATE },
    decision_remark: { type: DataTypes.TEXT }
  }, {
    tableName: 'tms_task_deadline_extensions',
    underscored: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false
  });

  TmsTaskDeadlineExtension.associate = (models) => {
    TmsTaskDeadlineExtension.belongsTo(models.TmsTask, { foreignKey: 'task_id', as: 'task' });
    TmsTaskDeadlineExtension.belongsTo(models.User, { foreignKey: 'extended_by', as: 'extendedBy' });
    TmsTaskDeadlineExtension.belongsTo(models.User, { foreignKey: 'approved_by', as: 'approvedBy' });
  };

  return TmsTaskDeadlineExtension;
};
