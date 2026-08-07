module.exports = (sequelize, DataTypes) => {
  const MarketingRequestComment = sequelize.define('MarketingRequestComment', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    marketing_request_id: { type: DataTypes.UUID, allowNull: false },
    at: { type: DataTypes.DATE },
    // Username, same convention as ProjectNote/ProjectTimelineEvent.by.
    by: { type: DataTypes.STRING },
    text: { type: DataTypes.TEXT }
  }, {
    tableName: 'marketing_request_comments',
    underscored: true,
    paranoid: false
  });

  MarketingRequestComment.associate = (models) => {
    MarketingRequestComment.belongsTo(models.MarketingRequest, { foreignKey: 'marketing_request_id', as: 'marketingRequest' });
  };

  return MarketingRequestComment;
};
