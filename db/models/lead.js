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
    project_id: { type: DataTypes.UUID },
    // Lead assignment — who owns working this lead, who assigned it, and when.
    // Separate from created_by, which stays "who captured it".
    assigned_to_id: { type: DataTypes.UUID },
    assigned_by_id: { type: DataTypes.UUID },
    assigned_at: { type: DataTypes.DATE }
  }, {
    tableName: 'leads',
    underscored: true,
    paranoid: true
  });

  Lead.associate = (models) => {
    Lead.belongsTo(models.Project, { foreignKey: 'project_id', as: 'project' });
    Lead.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
    Lead.belongsTo(models.User, { foreignKey: 'assigned_to_id', as: 'assignee' });
    Lead.belongsTo(models.User, { foreignKey: 'assigned_by_id', as: 'assigner' });
  };

  return Lead;
};
