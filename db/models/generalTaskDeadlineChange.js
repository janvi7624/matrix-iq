module.exports = (sequelize, DataTypes) => {
  const GeneralTaskDeadlineChange = sequelize.define('GeneralTaskDeadlineChange', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    task_id: { type: DataTypes.UUID, allowNull: false },
    previous_deadline: { type: DataTypes.DATEONLY, allowNull: false },
    new_deadline: { type: DataTypes.DATEONLY, allowNull: false },
    remark: { type: DataTypes.TEXT, allowNull: false },
    changed_by: { type: DataTypes.UUID }
  }, {
    tableName: 'general_task_deadline_changes',
    underscored: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false
  });

  GeneralTaskDeadlineChange.associate = (models) => {
    GeneralTaskDeadlineChange.belongsTo(models.GeneralTask, { foreignKey: 'task_id', as: 'task' });
    GeneralTaskDeadlineChange.belongsTo(models.User, { foreignKey: 'changed_by', as: 'changedBy' });
  };

  return GeneralTaskDeadlineChange;
};
