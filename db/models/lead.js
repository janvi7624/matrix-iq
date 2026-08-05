module.exports = (sequelize, DataTypes) => {
  const Lead = sequelize.define('Lead', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    created_by: { type: DataTypes.UUID },
    name: { type: DataTypes.STRING },
    mobile: { type: DataTypes.STRING },
    email: { type: DataTypes.STRING },
    designation: { type: DataTypes.STRING },
    company: { type: DataTypes.STRING },
    city: { type: DataTypes.STRING },
    card_image_url: { type: DataTypes.STRING },
    interests: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    sub_interests: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    priority: { type: DataTypes.ENUM('hot', 'warm', 'cool') },
    follow_up_actions: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    budget: { type: DataTypes.STRING },
    notes: { type: DataTypes.TEXT },
    // Set once "Convert to Project" runs.
    project_id: { type: DataTypes.UUID }
  }, {
    tableName: 'leads',
    underscored: true,
    paranoid: true
  });

  Lead.associate = (models) => {
    Lead.belongsTo(models.Project, { foreignKey: 'project_id', as: 'project' });
    Lead.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
  };

  return Lead;
};
