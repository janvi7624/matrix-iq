module.exports = (sequelize, DataTypes) => {
  const HrRecurringTaskTemplate = sequelize.define('HrRecurringTaskTemplate', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    title: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT },
    department_id: { type: DataTypes.UUID, allowNull: false },
    assignee_id: { type: DataTypes.UUID, allowNull: false },
    category_id: { type: DataTypes.UUID },
    priority: { type: DataTypes.ENUM('low', 'medium', 'high', 'critical'), allowNull: false, defaultValue: 'medium' },
    requires_review: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    recurrence_type: { type: DataTypes.ENUM('daily', 'weekly', 'monthly'), allowNull: false },
    recurrence_config: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    created_by: { type: DataTypes.UUID }
  }, {
    tableName: 'hr_recurring_task_templates',
    underscored: true
  });

  HrRecurringTaskTemplate.associate = (models) => {
    HrRecurringTaskTemplate.belongsTo(models.Department, { foreignKey: 'department_id', as: 'department' });
    HrRecurringTaskTemplate.belongsTo(models.User, { foreignKey: 'assignee_id', as: 'assignee' });
    HrRecurringTaskTemplate.belongsTo(models.HrTaskCategory, { foreignKey: 'category_id', as: 'category' });
    HrRecurringTaskTemplate.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
    HrRecurringTaskTemplate.hasMany(models.GeneralTask, { foreignKey: 'recurrence_template_id', as: 'instances' });
  };

  return HrRecurringTaskTemplate;
};
