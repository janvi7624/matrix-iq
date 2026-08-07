module.exports = (sequelize, DataTypes) => {
  const MarketingRequest = sequelize.define('MarketingRequest', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    created_by: { type: DataTypes.UUID },
    project_id: { type: DataTypes.UUID },
    title: { type: DataTypes.STRING },
    request_type: {
      type: DataTypes.ENUM(
        'brochure_flyer', 'social_media', 'banner_standee', 'video_reel', 'email_campaign',
        'website_update', 'product_photography', 'event_collateral', 'other'
      )
    },
    description: { type: DataTypes.TEXT },
    priority: { type: DataTypes.ENUM('low', 'medium', 'high', 'urgent'), allowNull: false, defaultValue: 'medium' },
    needed_by_date: { type: DataTypes.DATEONLY },
    attachments: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    status: {
      type: DataTypes.ENUM('submitted', 'timeline_set', 'in_progress', 'completed', 'rejected', 'cancelled'),
      allowNull: false,
      defaultValue: 'submitted'
    },
    // null until a reviewer commits it — once non-null, permanently locked
    // (enforced in lib/marketingRequestStore.ts, not at the DB layer).
    timeline: { type: DataTypes.JSONB },
    rejection_reason: { type: DataTypes.TEXT },
    completion_notes: { type: DataTypes.TEXT },
    delivered_files: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] }
  }, {
    tableName: 'marketing_requests',
    underscored: true,
    paranoid: true
  });

  MarketingRequest.associate = (models) => {
    MarketingRequest.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
    MarketingRequest.belongsTo(models.Project, { foreignKey: 'project_id', as: 'project' });
    MarketingRequest.hasMany(models.MarketingRequestComment, { foreignKey: 'marketing_request_id', as: 'comments' });
  };

  return MarketingRequest;
};
