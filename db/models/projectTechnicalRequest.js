// A sales-side request for a technical person on a Sales project, awaiting
// that person's (or their department manager's) approval — see
// lib/projectTechnicalRequest.ts and the migration that created the table.
module.exports = (sequelize, DataTypes) => {
  const ProjectTechnicalRequest = sequelize.define('ProjectTechnicalRequest', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    project_id: { type: DataTypes.UUID, allowNull: false },
    requested_user_id: { type: DataTypes.UUID, allowNull: false },
    requested_by_id: { type: DataTypes.UUID, allowNull: false },
    status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'pending' }, // pending | approved | declined | withdrawn
    note: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
    needed_by: { type: DataTypes.DATEONLY, allowNull: true },
    decided_by_id: { type: DataTypes.UUID, allowNull: true },
    decided_at: { type: DataTypes.DATE, allowNull: true },
    assigned_user_id: { type: DataTypes.UUID, allowNull: true },
    response_remarks: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' }
  }, {
    tableName: 'project_technical_requests',
    underscored: true,
    paranoid: false
  });

  ProjectTechnicalRequest.associate = (models) => {
    ProjectTechnicalRequest.belongsTo(models.Project, { foreignKey: 'project_id', as: 'project' });
    ProjectTechnicalRequest.belongsTo(models.User, { foreignKey: 'requested_user_id', as: 'requestedUser' });
    ProjectTechnicalRequest.belongsTo(models.User, { foreignKey: 'requested_by_id', as: 'requestedBy' });
    ProjectTechnicalRequest.belongsTo(models.User, { foreignKey: 'decided_by_id', as: 'decidedBy' });
    ProjectTechnicalRequest.belongsTo(models.User, { foreignKey: 'assigned_user_id', as: 'assignedUser' });
  };

  return ProjectTechnicalRequest;
};
