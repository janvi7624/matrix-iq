module.exports = (sequelize, DataTypes) => {
  const SiteVisit = sequelize.define('SiteVisit', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    created_by: { type: DataTypes.UUID },
    project_id: { type: DataTypes.UUID },
    company_name: { type: DataTypes.STRING },
    contact_person: { type: DataTypes.STRING },
    client_email: { type: DataTypes.STRING },
    client_phone: { type: DataTypes.STRING },
    location: { type: DataTypes.STRING },
    visit_date: { type: DataTypes.DATEONLY },
    team_technical: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    team_sales: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    purpose: { type: DataTypes.TEXT },
    // Domain key (DomainKey), nullable — free text/string, not enumerated here.
    category: { type: DataTypes.STRING },
    products_interested: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    visit_details: { type: DataTypes.TEXT },
    image_urls: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    action_plan: { type: DataTypes.TEXT },
    reminder_date: { type: DataTypes.DATEONLY },
    stage: { type: DataTypes.ENUM('hot', 'warm', 'cold') },
    status: { type: DataTypes.ENUM('open', 'closed'), allowNull: false, defaultValue: 'open' }
  }, {
    tableName: 'site_visits',
    underscored: true,
    paranoid: true
  });

  SiteVisit.associate = (models) => {
    SiteVisit.belongsTo(models.Project, { foreignKey: 'project_id', as: 'project' });
    SiteVisit.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
    SiteVisit.hasMany(models.SiteVisitUpdate, { foreignKey: 'site_visit_id', as: 'updates' });
  };

  return SiteVisit;
};
