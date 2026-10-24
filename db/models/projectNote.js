module.exports = (sequelize, DataTypes) => {
  const ProjectNote = sequelize.define('ProjectNote', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    project_id: { type: DataTypes.UUID, allowNull: false },
    at: { type: DataTypes.DATE },
    by: { type: DataTypes.STRING },
    text: { type: DataTypes.TEXT },
    // Default false — internal by default. See the 20261020094000 migration.
    partner_visible: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }
  }, {
    tableName: 'project_notes',
    underscored: true,
    paranoid: false
  });

  ProjectNote.associate = (models) => {
    ProjectNote.belongsTo(models.Project, { foreignKey: 'project_id', as: 'project' });
  };

  return ProjectNote;
};
