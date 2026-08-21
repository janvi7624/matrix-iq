module.exports = (sequelize, DataTypes) => {
  const ProjectHandoverRequest = sequelize.define('ProjectHandoverRequest', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    project_id: { type: DataTypes.UUID, allowNull: false },
    from_user_id: { type: DataTypes.UUID, allowNull: false },
    to_user_id: { type: DataTypes.UUID, allowNull: false },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'pending' }, // pending | approved | rejected
    remarks: { type: DataTypes.TEXT, allowNull: true, defaultValue: '' },
    response_remarks: { type: DataTypes.TEXT, allowNull: true, defaultValue: '' }
  }, {
    tableName: 'project_handover_requests',
    underscored: true,
    paranoid: false
  });

  ProjectHandoverRequest.associate = (models) => {
    ProjectHandoverRequest.belongsTo(models.Project, { foreignKey: 'project_id', as: 'project' });
    ProjectHandoverRequest.belongsTo(models.User, { foreignKey: 'from_user_id', as: 'fromUser' });
    ProjectHandoverRequest.belongsTo(models.User, { foreignKey: 'to_user_id', as: 'toUser' });
  };

  return ProjectHandoverRequest;
};
