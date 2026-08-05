module.exports = (sequelize, DataTypes) => {
  const SiteVisitUpdate = sequelize.define('SiteVisitUpdate', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    site_visit_id: { type: DataTypes.UUID, allowNull: false },
    // Business field (when this update entry was logged) — collides in name
    // with Sequelize's automatic `updatedAt`, so that automatic timestamp is
    // disabled below and this plain column is the sole `updated_at`.
    updated_at: { type: DataTypes.DATE },
    updated_by: { type: DataTypes.STRING },
    team_technical: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    team_sales: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    project_details: { type: DataTypes.TEXT },
    ongoing_activities: { type: DataTypes.TEXT }
  }, {
    tableName: 'site_visit_updates',
    underscored: true,
    paranoid: false,
    updatedAt: false
  });

  SiteVisitUpdate.associate = (models) => {
    SiteVisitUpdate.belongsTo(models.SiteVisit, { foreignKey: 'site_visit_id', as: 'siteVisit' });
  };

  return SiteVisitUpdate;
};
