module.exports = (sequelize, DataTypes) => {
  const TmsProjectDepartment = sequelize.define('TmsProjectDepartment', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    tms_project_id: { type: DataTypes.UUID, allowNull: false },
    department_id: { type: DataTypes.UUID, allowNull: false }
  }, {
    tableName: 'tms_project_departments',
    underscored: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false
  });

  TmsProjectDepartment.associate = (models) => {
    TmsProjectDepartment.belongsTo(models.TmsProject, { foreignKey: 'tms_project_id', as: 'project' });
    TmsProjectDepartment.belongsTo(models.Department, { foreignKey: 'department_id', as: 'department' });
  };

  return TmsProjectDepartment;
};
