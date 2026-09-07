module.exports = (sequelize, DataTypes) => {
  const GeneralTaskUpdate = sequelize.define('GeneralTaskUpdate', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    task_id: { type: DataTypes.UUID, allowNull: false },
    status_at_update: { type: DataTypes.STRING(30), allowNull: false },
    work_summary: { type: DataTypes.TEXT },
    remarks: { type: DataTypes.TEXT },
    attachments: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    updated_by: { type: DataTypes.UUID }
  }, {
    tableName: 'general_task_updates',
    underscored: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false
  });

  GeneralTaskUpdate.associate = (models) => {
    GeneralTaskUpdate.belongsTo(models.GeneralTask, { foreignKey: 'task_id', as: 'task' });
    GeneralTaskUpdate.belongsTo(models.User, { foreignKey: 'updated_by', as: 'updatedBy' });
  };

  return GeneralTaskUpdate;
};
