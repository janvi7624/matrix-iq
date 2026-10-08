module.exports = (sequelize, DataTypes) => {
  const TmsProject = sequelize.define('TmsProject', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    project_code: { type: DataTypes.STRING, unique: true },
    name: { type: DataTypes.STRING, allowNull: false },
    client_name: { type: DataTypes.STRING },
    client_contact: { type: DataTypes.TEXT },
    description: { type: DataTypes.TEXT },
    department_id: { type: DataTypes.UUID, allowNull: false },
    project_manager_id: { type: DataTypes.UUID },
    // Project "team" — plain JSONB array of user ids, same shape precedent as
    // Department.managerIds — no per-member metadata (role-on-project, join
    // date, etc.) is needed per spec, so a join table would be premature.
    team_member_ids: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    start_date: { type: DataTypes.DATEONLY },
    estimated_close_date: { type: DataTypes.DATEONLY },
    actual_close_date: { type: DataTypes.DATEONLY },
    // Controlled-extension deadline (see tms_project_deadline_extensions) —
    // deliberately separate from estimated_close_date/actual_close_date,
    // which already drive unrelated existing behavior.
    deadline: { type: DataTypes.DATEONLY },
    budget: { type: DataTypes.DECIMAL(14, 2) },
    status: { type: DataTypes.ENUM('planning', 'not_started', 'in_progress', 'on_hold', 'completed', 'cancelled'), allowNull: false, defaultValue: 'planning' },
    // 'department' = single owning department (department_id). 'combined' =
    // multiple departments, real membership in tms_project_departments;
    // department_id still holds the primary/owning one for every existing
    // single-department caller.
    project_type: { type: DataTypes.ENUM('department', 'combined'), allowNull: false, defaultValue: 'department' },
    priority: { type: DataTypes.ENUM('low', 'medium', 'high'), allowNull: false, defaultValue: 'medium' },
    progress_percent: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    remarks: { type: DataTypes.TEXT },
    attachments: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    created_by: { type: DataTypes.UUID },
    // Where this project came from, when it did — set once by
    // lib/tmsHandoff.ts at the moment a Sales project's technical-person
    // assignment is approved. sales_person_name/_username are denormalized
    // (same pattern as project_manager_name/department_name) so the TMS side
    // never needs to join back to Sales just to show who handed a project
    // over, across however many hundreds of these exist.
    sales_project_id: { type: DataTypes.UUID },
    sales_person_name: { type: DataTypes.STRING },
    sales_person_username: { type: DataTypes.STRING }
  }, {
    tableName: 'tms_projects',
    underscored: true,
    paranoid: true
  });

  TmsProject.associate = (models) => {
    TmsProject.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
    TmsProject.belongsTo(models.User, { foreignKey: 'project_manager_id', as: 'projectManager' });
    TmsProject.belongsTo(models.Department, { foreignKey: 'department_id', as: 'department' });
    TmsProject.hasMany(models.TmsTask, { foreignKey: 'project_id', as: 'tasks' });
    TmsProject.hasMany(models.TmsBomRequest, { foreignKey: 'project_id', as: 'bomRequests' });
    TmsProject.hasMany(models.TmsProcurement, { foreignKey: 'project_id', as: 'procurements' });
    TmsProject.hasMany(models.TmsProjectDeadlineExtension, { foreignKey: 'tms_project_id', as: 'deadlineExtensions' });
    TmsProject.hasMany(models.TmsProjectPhase, { foreignKey: 'tms_project_id', as: 'phases' });
    TmsProject.belongsToMany(models.Department, { through: models.TmsProjectDepartment, foreignKey: 'tms_project_id', otherKey: 'department_id', as: 'departments' });
  };

  return TmsProject;
};
