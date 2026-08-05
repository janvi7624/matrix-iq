module.exports = (sequelize, DataTypes) => {
  const Installation = sequelize.define('Installation', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    created_by: { type: DataTypes.UUID },
    project_id: { type: DataTypes.UUID },
    installation_date: { type: DataTypes.DATEONLY },
    assigned_engineer: { type: DataTypes.STRING },
    status: { type: DataTypes.ENUM('scheduled', 'in_progress', 'completed'), allowNull: false, defaultValue: 'scheduled' },
    completion_report: { type: DataTypes.TEXT },
    client_signature: { type: DataTypes.STRING }
  }, {
    tableName: 'installations',
    underscored: true,
    paranoid: true
  });

  Installation.associate = (models) => {
    Installation.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
    Installation.belongsTo(models.Project, { foreignKey: 'project_id', as: 'project' });
  };

  return Installation;
};
