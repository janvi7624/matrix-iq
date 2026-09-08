module.exports = (sequelize, DataTypes) => {
  const GeneralTask = sequelize.define('GeneralTask', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    source_module: { type: DataTypes.ENUM('admin', 'hr', 'team'), allowNull: false },
    title: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT },
    department_id: { type: DataTypes.UUID, allowNull: false },
    // Nullable — "Leave Unassigned" (Task Planner department-wide tasks with
    // no owner yet). See lib/generalTaskStore.ts's list() for how an
    // unassigned task stays visible to its department's managers.
    assignee_id: { type: DataTypes.UUID },
    created_by: { type: DataTypes.UUID },
    reviewer_id: { type: DataTypes.UUID },
    priority: { type: DataTypes.ENUM('low', 'medium', 'high', 'critical'), allowNull: false, defaultValue: 'medium' },
    status: {
      type: DataTypes.ENUM('pending', 'in_progress', 'under_review', 'rework_required', 'approved', 'rejected', 'cancelled', 'completed'),
      allowNull: false,
      defaultValue: 'pending'
    },
    requires_review: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    category: { type: DataTypes.STRING },
    project_id: { type: DataTypes.UUID },
    // Optional link to a TMS project (separate from the Sales project_id
    // above) — see Task Planner's "Link To -> TMS Project".
    tms_project_id: { type: DataTypes.UUID },
    start_date: { type: DataTypes.DATEONLY },
    deadline: { type: DataTypes.DATEONLY, allowNull: false },
    remarks: { type: DataTypes.TEXT },
    attachments: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    labels: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    recurrence_template_id: { type: DataTypes.UUID },
    recurrence_period_key: { type: DataTypes.STRING }
  }, {
    tableName: 'general_tasks',
    underscored: true,
    paranoid: true
  });

  GeneralTask.associate = (models) => {
    GeneralTask.belongsTo(models.Department, { foreignKey: 'department_id', as: 'department' });
    GeneralTask.belongsTo(models.User, { foreignKey: 'assignee_id', as: 'assignee' });
    GeneralTask.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
    GeneralTask.belongsTo(models.User, { foreignKey: 'reviewer_id', as: 'reviewer' });
    GeneralTask.belongsTo(models.Project, { foreignKey: 'project_id', as: 'project' });
    GeneralTask.belongsTo(models.TmsProject, { foreignKey: 'tms_project_id', as: 'tmsProject' });
    GeneralTask.belongsTo(models.HrRecurringTaskTemplate, { foreignKey: 'recurrence_template_id', as: 'recurrenceTemplate' });
    GeneralTask.hasMany(models.GeneralTaskUpdate, { foreignKey: 'task_id', as: 'updates' });
    GeneralTask.hasMany(models.GeneralTaskDeadlineChange, { foreignKey: 'task_id', as: 'deadlineChanges' });
  };

  return GeneralTask;
};
