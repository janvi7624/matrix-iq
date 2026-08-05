module.exports = (sequelize, DataTypes) => {
  const ProjectTimelineEvent = sequelize.define('ProjectTimelineEvent', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    project_id: { type: DataTypes.UUID, allowNull: false },
    at: { type: DataTypes.DATE },
    by: { type: DataTypes.STRING },
    // Includes 'created' plus all ProjectStage values, so STRING not ENUM.
    stage: { type: DataTypes.STRING },
    label: { type: DataTypes.STRING },
    remarks: { type: DataTypes.TEXT }
  }, {
    tableName: 'project_timeline_events',
    underscored: true,
    paranoid: false
  });

  ProjectTimelineEvent.associate = (models) => {
    ProjectTimelineEvent.belongsTo(models.Project, { foreignKey: 'project_id', as: 'project' });
  };

  return ProjectTimelineEvent;
};
