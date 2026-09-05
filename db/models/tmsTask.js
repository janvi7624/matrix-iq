module.exports = (sequelize, DataTypes) => {
  const TmsTask = sequelize.define('TmsTask', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    project_id: { type: DataTypes.UUID, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    assignee_id: { type: DataTypes.UUID },
    department_id: { type: DataTypes.UUID },
    description: { type: DataTypes.TEXT },
    priority: { type: DataTypes.ENUM('low', 'medium', 'high'), allowNull: false, defaultValue: 'medium' },
    status: { type: DataTypes.ENUM('to_do', 'in_progress', 'on_hold', 'completed', 'cancelled', 'blocked', 'ready_for_review'), allowNull: false, defaultValue: 'to_do' },
    // Live per-task progress — rolls up into TmsProject's task-derived
    // progress (see lib/tmsProjectStore.ts's computeTaskDerivedProgress).
    progress_percent: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    start_date: { type: DataTypes.DATEONLY },
    due_date: { type: DataTypes.DATEONLY },
    // Set automatically when status transitions into/out of 'completed' —
    // see lib/tmsTaskStore.ts. No hours/time-tracking field exists here or
    // anywhere else in this module by design.
    completion_date: { type: DataTypes.DATEONLY },
    remarks: { type: DataTypes.TEXT },
    attachments: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    created_by: { type: DataTypes.UUID }
  }, {
    tableName: 'tms_tasks',
    underscored: true,
    paranoid: true
  });

  TmsTask.associate = (models) => {
    TmsTask.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
    TmsTask.belongsTo(models.User, { foreignKey: 'assignee_id', as: 'assignee' });
    TmsTask.belongsTo(models.Department, { foreignKey: 'department_id', as: 'department' });
    TmsTask.belongsTo(models.TmsProject, { foreignKey: 'project_id', as: 'project' });
    TmsTask.hasMany(models.TmsTaskUpdate, { foreignKey: 'task_id', as: 'updates' });
  };

  return TmsTask;
};
