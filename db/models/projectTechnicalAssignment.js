// Every CURRENTLY assigned technical person on a Sales project — see
// lib/projectTechnicalRequest.ts and the migration that created this table
// for why this exists alongside projects.assigned_technical_person_id rather
// than instead of it.
module.exports = (sequelize, DataTypes) => {
  const ProjectTechnicalAssignment = sequelize.define('ProjectTechnicalAssignment', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    project_id: { type: DataTypes.UUID, allowNull: false },
    user_id: { type: DataTypes.UUID, allowNull: false },
    assigned_by_id: { type: DataTypes.UUID, allowNull: true }
  }, {
    tableName: 'project_technical_assignments',
    underscored: true,
    paranoid: false
  });

  ProjectTechnicalAssignment.associate = (models) => {
    ProjectTechnicalAssignment.belongsTo(models.Project, { foreignKey: 'project_id', as: 'project' });
    ProjectTechnicalAssignment.belongsTo(models.User, { foreignKey: 'user_id', as: 'person' });
    ProjectTechnicalAssignment.belongsTo(models.User, { foreignKey: 'assigned_by_id', as: 'assignedBy' });
  };

  return ProjectTechnicalAssignment;
};
