module.exports = (sequelize, DataTypes) => {
  const TmsTaskUpdate = sequelize.define('TmsTaskUpdate', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    task_id: { type: DataTypes.UUID, allowNull: false },
    progress_percent: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    status_at_update: { type: DataTypes.STRING(30), allowNull: false },
    remark: { type: DataTypes.TEXT },
    attachments: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    updated_by: { type: DataTypes.UUID }
  }, {
    tableName: 'tms_task_updates',
    underscored: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false
  });

  TmsTaskUpdate.associate = (models) => {
    TmsTaskUpdate.belongsTo(models.TmsTask, { foreignKey: 'task_id', as: 'task' });
    TmsTaskUpdate.belongsTo(models.User, { foreignKey: 'updated_by', as: 'updatedBy' });
  };

  return TmsTaskUpdate;
};
